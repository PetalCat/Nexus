import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, UserCredential } from './types';
import { withCache } from '../server/cache';
import { AdapterAuthError } from './errors';
import { opdsFetch, opdsFetchAllPages, opdsPing } from './calibre/opds-client';
import { opdsEntryToUnifiedMedia, acquisitionsToFormats } from './calibre/normalize';
import { sessionPost, sessionGet, getSessionCookie } from './calibre/session-client';
import type { OpdsEntry, CalibreFormat } from './calibre/types';

// ---------------------------------------------------------------------------
// Calibre-Web adapter — OPDS-first rewrite (2026-04-13).
// See docs/superpowers/specs/2026-04-13-calibre-adapter-rewrite-design.md
// Read path is 100% OPDS (HTTP Basic auth). Session-cookie flow is used for
// setItemStatus (toggleread) and createUser only.
// ---------------------------------------------------------------------------

const ALL_BOOKS_CACHE_MS = 300_000;

async function fetchAllBooks(config: ServiceConfig, userCred?: UserCredential): Promise<OpdsEntry[]> {
	return withCache(`calibre-opds-all:${config.id}:${userCred?.externalUsername ?? ''}`, ALL_BOOKS_CACHE_MS, () =>
		opdsFetchAllPages(config, '/opds/books/letter/00', userCred)
	);
}

function sortEntriesInMemory(entries: OpdsEntry[], sortBy: string | undefined): OpdsEntry[] {
	if (!sortBy || sortBy === 'title') {
		return [...entries].sort((a, b) => a.title.localeCompare(b.title));
	}
	if (sortBy === 'year') {
		return [...entries].sort((a, b) => {
			const ay = a.published?.getTime() ?? 0;
			const by = b.published?.getTime() ?? 0;
			return by - ay;
		});
	}
	if (sortBy === 'rating') {
		return [...entries].sort((a, b) => (b.ratingStars ?? 0) - (a.ratingStars ?? 0));
	}
	if (sortBy === 'added') {
		return [...entries].sort((a, b) => {
			const au = a.updated?.getTime() ?? 0;
			const bu = b.updated?.getTime() ?? 0;
			return bu - au;
		});
	}
	return entries;
}

export const calibreAdapter: ServiceAdapter = {
	id: 'calibre',
	displayName: 'Calibre-Web',
	defaultPort: 8083,
	color: '#7b68ee',
	abbreviation: 'CA',
	isLibrary: true,
	isSearchable: true,
	searchPriority: 0,
	icon: 'calibre',
	mediaTypes: ['book'],
	userLinkable: true,
	onboarding: {
		category: 'books',
		description: 'Read books, take notes, and track reading progress',
		priority: 1,
		requiredFields: ['url', 'username', 'password'],
		supportsAutoAuth: true
	},

	contractVersion: 1,
	tier: 'user-standalone',
	capabilities: {
		media: ['book'],
		// Calibre-Web's admin account is just a regular user credential used by
		// Nexus for reads when no per-user cred is available. Optional.
		adminAuth: {
			required: false,
			fields: ['url', 'adminUsername', 'adminPassword'],
			supportsHealthProbe: true
		},
		userAuth: {
			userLinkable: true,
			usernameLabel: 'Username',
			supportsRegistration: false,
			supportsAccountCreation: true,
			supportsPasswordStorage: true,
			supportsHealthProbe: true
		},
		library: true,
		search: { priority: 0 }
	},

	async probeAdminCredential(config) {
		try {
			// Anonymous GET /opds returns 401 when Basic is needed — always is for Calibre-Web
			const res = await fetch(`${config.url}/opds`, {
				headers: {
					Authorization: `Basic ${Buffer.from(`${config.username ?? ''}:${config.password ?? ''}`, 'utf-8').toString('base64')}`
				},
				signal: AbortSignal.timeout(5000)
			});
			if (res.status === 401) return 'invalid';
			if (!res.ok) return 'expired';
			return 'ok';
		} catch {
			return 'expired';
		}
	},

	async probeCredential(config, userCred) {
		try {
			const user = userCred.externalUsername ?? '';
			const pass = userCred.accessToken ?? '';
			if (!user || !pass) return 'invalid';
			const res = await fetch(`${config.url}/opds`, {
				headers: {
					Authorization: `Basic ${Buffer.from(`${user}:${pass}`, 'utf-8').toString('base64')}`
				},
				signal: AbortSignal.timeout(5000)
			});
			if (res.status === 401) return 'invalid';
			if (!res.ok) return 'expired';
			return 'ok';
		} catch {
			return 'expired';
		}
	},

	async refreshCredential(config, userCred, storedPassword) {
		// Calibre-Web Basic auth — the "refresh" is just re-authenticating with
		// the same (username, stored password) pair against /opds.
		const username = userCred.externalUsername;
		if (!username) throw new Error('Calibre-Web refresh: missing username');
		const testConfig: ServiceConfig = { ...config, username, password: storedPassword };
		await opdsPing(testConfig);
		return {
			accessToken: storedPassword,
			externalUserId: username,
			externalUsername: username
		};
	},

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await opdsPing(config);
			return {
				serviceId: config.id,
				name: config.name,
				type: 'calibre',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'calibre',
				online: false,
				error: String(e)
			};
		}
	},

	async getContinueWatching(): Promise<UnifiedMedia[]> {
		// Calibre has no per-page reading progress upstream. The previous
		// implementation read /opds/unreadbooks and stamped a fake
		// progress=0.05 on every entry, which polluted the unified
		// Continue Watching row. Deleted as part of the 2026-04-17 player
		// alignment plan (#12). If issue #11 (real page tracking) ever
		// lands, Calibre progress will flow through `play_sessions` like
		// everything else — not through this method.
		return [];
	},

	async getRecentlyAdded(config, userCred): Promise<UnifiedMedia[]> {
		try {
			const feed = await opdsFetch(config, '/opds/new', userCred);
			return feed.entries.slice(0, 20).map((entry) => opdsEntryToUnifiedMedia(config, entry));
		} catch {
			return [];
		}
	},

	async search(config, query, userCred): Promise<UnifiedSearchResult> {
		try {
			const encoded = encodeURIComponent(query);
			const feed = await opdsFetch(config, `/opds/search/${encoded}`, userCred);
			const items = feed.entries.map((entry) => opdsEntryToUnifiedMedia(config, entry));
			return { items, total: items.length, source: 'calibre' };
		} catch {
			return { items: [], total: 0, source: 'calibre' };
		}
	},

	async getItem(config, sourceId, userCred): Promise<UnifiedMedia | null> {
		try {
			// OPDS search doesn't support field syntax (id:N / title:X return empty), so
			// we walk the cached all-books feed. With the 5-min cache this is cheap.
			const all = await fetchAllBooks(config, userCred);
			const match = all.find((e) => e.id === sourceId);
			return match ? opdsEntryToUnifiedMedia(config, match) : null;
		} catch {
			return null;
		}
	},

	async getLibrary(config, opts, userCred): Promise<{ items: UnifiedMedia[]; total: number }> {
		try {
			const sortBy = opts?.sortBy;
			const offset = opts?.offset ?? 0;
			const limit = opts?.limit ?? 50;

			// For `added` and `rating`, prefer the dedicated OPDS feeds when the caller
			// just wants the first page; these return server-sorted results and don't
			// require a full library walk.
			if (sortBy === 'added' && offset === 0) {
				const feed = await opdsFetch(config, '/opds/new', userCred);
				const items = feed.entries.slice(0, limit).map((e) => opdsEntryToUnifiedMedia(config, e));
				return { items, total: feed.totalResults ?? items.length };
			}
			if (sortBy === 'rating' && offset === 0) {
				const feed = await opdsFetch(config, '/opds/rated', userCred);
				const items = feed.entries.slice(0, limit).map((e) => opdsEntryToUnifiedMedia(config, e));
				return { items, total: feed.totalResults ?? items.length };
			}

			// All other cases: full walk + in-memory sort + slice.
			const all = await fetchAllBooks(config, userCred);
			const sorted = sortEntriesInMemory(all, sortBy);
			const page = sorted.slice(offset, offset + limit);
			return {
				items: page.map((e) => opdsEntryToUnifiedMedia(config, e)),
				total: all.length
			};
		} catch {
			return { items: [], total: 0 };
		}
	},

	async authenticateUser(config, username, password) {
		// OPDS root with Basic auth is the cheapest way to verify credentials.
		const testConfig: ServiceConfig = { ...config, username, password };
		try {
			await opdsPing(testConfig);
		} catch (err) {
			// opdsPing throws plain Error with messages like "authentication failed"
			// or "unreachable". Map to structured AdapterAuthError so the shared UI
			// copy renders the right message.
			const msg = err instanceof Error ? err.message : String(err);
			if (/401|authentic|password/i.test(msg)) {
				throw new AdapterAuthError('Invalid Calibre-Web credentials', 'invalid');
			}
			if (/unreach|ENOTFOUND|ECONNREFUSED|timeout|abort/i.test(msg)) {
				throw new AdapterAuthError(`Cannot reach Calibre-Web at ${config.url}`, 'unreachable');
			}
			throw new AdapterAuthError(msg, 'invalid');
		}
		return {
			accessToken: password,
			externalUserId: username,
			externalUsername: username
		};
	},

	async createUser(config, username, password) {
		// Admin creates new users via the /admin/user/new form — session cookie required.
		const formRes = await sessionGet(config, '/admin/user/new');
		if (!formRes.ok) {
			throw new Error(`Calibre-Web /admin/user/new → HTTP ${formRes.status}`);
		}
		const html = await formRes.text();
		const csrfMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/);
		if (!csrfMatch) {
			throw new Error('Calibre-Web: could not find csrf_token on /admin/user/new — is the admin account configured correctly?');
		}

		const defaultLang =
			html.match(/name="default_language"[^>]*>[\s\S]*?<option[^>]*selected[^>]*value="([^"]*)"/)?.[1] ??
			html.match(/id="default_language"[^>]*>[\s\S]*?<option[^>]*selected[^>]*value="([^"]*)"/)?.[1] ??
			'all';
		const locale =
			html.match(/name="locale"[^>]*>[\s\S]*?<option[^>]*selected[^>]*value="([^"]*)"/)?.[1] ??
			html.match(/id="locale"[^>]*>[\s\S]*?<option[^>]*selected[^>]*value="([^"]*)"/)?.[1] ??
			'en';

		const body = new URLSearchParams({
			name: username,
			email: `${username}@nexus.local`,
			password,
			default_language: defaultLang,
			locale,
			csrf_token: csrfMatch[1]
		});

		const createRes = await sessionPost(config, '/admin/user/new', {
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString()
		});

		// Calibre-Web returns 200 for failures and 302 for success. Detect flash text.
		if (createRes.status !== 302) {
			const resHtml = await createRes.text();
			const lower = resHtml.toLowerCase();
			const alreadyExists =
				lower.includes('existing account') ||
				lower.includes('already exists') ||
				lower.includes('is already taken');
			if (alreadyExists) {
				// User already exists — try to authenticate with the provided password.
				const testConfig: ServiceConfig = { ...config, username, password };
				try {
					await opdsPing(testConfig);
					return { accessToken: password, externalUserId: username, externalUsername: username };
				} catch {
					throw new Error(`Calibre-Web user "${username}" already exists — link manually via My Accounts`);
				}
			}
			if (lower.includes('please complete all fields')) {
				throw new Error('Calibre-Web user creation failed: missing required fields');
			}
			if (lower.includes('database error')) {
				throw new Error('Calibre-Web user creation failed: database error');
			}
			throw new Error('Calibre-Web user creation failed — check admin credentials and permissions');
		}

		// Verify by authenticating as the new user
		const testConfig: ServiceConfig = { ...config, username, password };
		await opdsPing(testConfig);
		return {
			accessToken: password,
			externalUserId: username,
			externalUsername: username
		};
	},

	async getImageHeaders(config, userCred): Promise<Record<string, string>> {
		try {
			const user = userCred?.externalUsername ?? config.username ?? '';
			const pass = userCred?.accessToken ?? config.password ?? '';
			if (!user || !pass) return {};
			const token = Buffer.from(`${user}:${pass}`, 'utf-8').toString('base64');
			return { Authorization: `Basic ${token}` };
		} catch {
			return {};
		}
	},

	async getServiceData(config, dataType, _params, userCred) {
		switch (dataType) {
			case 'series':
				return getCalibreSeries(config, userCred);
			case 'all':
				return getAllBooks(config, userCred);
			case 'categories':
				return getCalibreCategories(config, userCred);
			case 'authors':
				return getCalibreAuthors(config, userCred);
			default:
				return null;
		}
	},

	async enrichItem(config, item, enrichmentType, userCred) {
		if (enrichmentType === 'formats') {
			const formats = await getCalibreBookFormats(config, item.sourceId, userCred);
			return { ...item, metadata: { ...item.metadata, formats: formats.formats } };
		}
		if (enrichmentType === 'related') {
			const related = await getRelatedBooks(config, item.sourceId, userCred);
			return { ...item, metadata: { ...item.metadata, related } };
		}
		return item;
	},

	async setItemStatus(config, sourceId, status, userCred) {
		if ((status as Record<string, unknown>).read != null) {
			await toggleReadStatus(config, sourceId, userCred);
		}
	},

	async downloadContent(config, sourceId, format, userCred) {
		return downloadBook(config, sourceId, format ?? 'epub', userCred);
	}
};

// ---------------------------------------------------------------------------
// Exported helpers (internal to this module; called via getServiceData / enrichItem)
// ---------------------------------------------------------------------------

export interface CalibreSeries {
	name: string;
	books: UnifiedMedia[];
}

export async function getCalibreSeries(config: ServiceConfig, userCred?: UserCredential): Promise<CalibreSeries[]> {
	return withCache(`calibre-series:${config.id}`, 300_000, async () => {
		try {
			const entries = await fetchAllBooks(config, userCred);
			const map = new Map<string, UnifiedMedia[]>();
			for (const entry of entries) {
				if (!entry.series) continue;
				const item = opdsEntryToUnifiedMedia(config, entry);
				const existing = map.get(entry.series) ?? [];
				existing.push(item);
				map.set(entry.series, existing);
			}
			return Array.from(map.entries()).map(([name, books]) => ({ name, books }));
		} catch {
			return [];
		}
	});
}

export interface CalibreAuthor {
	name: string;
	bookCount: number;
}

export async function getCalibreAuthors(config: ServiceConfig, userCred?: UserCredential): Promise<CalibreAuthor[]> {
	return withCache(`calibre-authors:${config.id}`, 300_000, async () => {
		try {
			const entries = await fetchAllBooks(config, userCred);
			const map = new Map<string, number>();
			for (const entry of entries) {
				for (const author of entry.authors) {
					const trimmed = author.trim();
					if (trimmed) map.set(trimmed, (map.get(trimmed) ?? 0) + 1);
				}
			}
			return Array.from(map.entries())
				.map(([name, bookCount]) => ({ name, bookCount }))
				.sort((a, b) => b.bookCount - a.bookCount);
		} catch {
			return [];
		}
	});
}

export async function getCalibreCategories(config: ServiceConfig, userCred?: UserCredential): Promise<string[]> {
	return withCache(`calibre-categories:${config.id}`, 300_000, async () => {
		try {
			const entries = await fetchAllBooks(config, userCred);
			const tags = new Set<string>();
			for (const entry of entries) {
				for (const cat of entry.categories) {
					const trimmed = cat.trim();
					if (trimmed) tags.add(trimmed);
				}
			}
			return Array.from(tags).sort();
		} catch {
			return [];
		}
	});
}

export interface CalibreBookFormats {
	formats: CalibreFormat[];
}

export async function getCalibreBookFormats(
	config: ServiceConfig,
	bookId: string,
	userCred?: UserCredential
): Promise<CalibreBookFormats> {
	try {
		const all = await fetchAllBooks(config, userCred);
		const match = all.find((e) => e.id === bookId);
		if (!match) return { formats: [] };
		return { formats: acquisitionsToFormats(match) };
	} catch {
		return { formats: [] };
	}
}

export interface RelatedBooks {
	sameAuthor: UnifiedMedia[];
	sameSeries: UnifiedMedia[];
	nextInSeries?: UnifiedMedia;
	prevInSeries?: UnifiedMedia;
}

export async function getRelatedBooks(
	config: ServiceConfig,
	bookId: string,
	userCred?: UserCredential
): Promise<RelatedBooks> {
	try {
		const entries = await fetchAllBooks(config, userCred);
		const current = entries.find((e) => e.id === bookId);
		if (!current) return { sameAuthor: [], sameSeries: [] };

		const currentAuthors = new Set(current.authors.map((a) => a.trim()));
		const sameAuthor: UnifiedMedia[] = [];
		const sameSeries: UnifiedMedia[] = [];
		let nextInSeries: UnifiedMedia | undefined;
		let prevInSeries: UnifiedMedia | undefined;

		for (const entry of entries) {
			if (entry.id === bookId) continue;
			if (entry.authors.some((a) => currentAuthors.has(a.trim()))) {
				sameAuthor.push(opdsEntryToUnifiedMedia(config, entry));
			}
			if (current.series && entry.series === current.series) {
				const item = opdsEntryToUnifiedMedia(config, entry);
				sameSeries.push(item);
				if (
					current.seriesIndex !== undefined &&
					entry.seriesIndex !== undefined &&
					entry.seriesIndex === current.seriesIndex + 1
				) {
					nextInSeries = item;
				}
				if (
					current.seriesIndex !== undefined &&
					entry.seriesIndex !== undefined &&
					entry.seriesIndex === current.seriesIndex - 1
				) {
					prevInSeries = item;
				}
			}
		}

		return { sameAuthor: sameAuthor.slice(0, 20), sameSeries, nextInSeries, prevInSeries };
	} catch {
		return { sameAuthor: [], sameSeries: [] };
	}
}

export async function toggleReadStatus(
	config: ServiceConfig,
	bookId: string,
	userCred?: UserCredential
): Promise<boolean> {
	const res = await sessionPost(config, `/ajax/toggleread/${bookId}`, {}, userCred);
	return res.ok;
}

export async function downloadBook(
	config: ServiceConfig,
	bookId: string,
	format: string,
	userCred?: UserCredential
): Promise<Response> {
	// Use /opds/download/{id}/{fmt}/ with Basic auth — no session cookie needed.
	const user = userCred?.externalUsername ?? config.username ?? '';
	const pass = userCred?.accessToken ?? config.password ?? '';
	if (!user || !pass) {
		// Fall back to session-cookie download if no basic creds available.
		const cookie = await getSessionCookie(config, userCred);
		const res = await fetch(`${config.url}/download/${bookId}/${format.toLowerCase()}`, {
			headers: { Cookie: cookie },
			signal: AbortSignal.timeout(30_000),
			redirect: 'follow'
		});
		if (!res.ok) throw new Error(`Calibre-Web download failed: ${res.status}`);
		return res;
	}
	const token = Buffer.from(`${user}:${pass}`, 'utf-8').toString('base64');
	const res = await fetch(`${config.url}/opds/download/${bookId}/${format.toLowerCase()}/`, {
		headers: { Authorization: `Basic ${token}` },
		signal: AbortSignal.timeout(30_000)
	});
	if (!res.ok) throw new Error(`Calibre-Web download failed: ${res.status}`);
	return res;
}

/** Fetch all books as UnifiedMedia (cached) — used by enrichment data. */
export async function getAllBooks(
	config: ServiceConfig,
	userCred?: UserCredential
): Promise<UnifiedMedia[]> {
	return withCache(`calibre-allbooks:${config.id}`, 300_000, async () => {
		try {
			const entries = await fetchAllBooks(config, userCred);
			return entries.map((e) => opdsEntryToUnifiedMedia(config, e));
		} catch {
			return [];
		}
	});
}
