import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, UserCredential } from './types';
import { withCache } from '../server/cache';

// ---------------------------------------------------------------------------
// Calibre-Web JSON API adapter
// Uses session-cookie auth against Calibre-Web's /ajax/listbooks endpoint.
// ---------------------------------------------------------------------------

interface CalibreSession {
	cookie: string;
	expiresAt: number;
}

const sessionCache = new Map<string, CalibreSession>();

export async function getSession(config: ServiceConfig, userCred?: UserCredential): Promise<string> {
	const user = userCred?.externalUsername ?? config.username ?? '';
	const pass = userCred?.accessToken ?? config.password ?? '';
	const cacheKey = `${config.id}:${user}`;

	const cached = sessionCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) return cached.cookie;

	// Step 1: GET /login to get CSRF token + session cookie
	const loginPage = await fetch(`${config.url}/login`, {
		redirect: 'manual',
		signal: AbortSignal.timeout(8000)
	});
	const html = await loginPage.text();
	const csrfMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/);
	if (!csrfMatch) throw new Error('Could not find CSRF token on login page');
	const csrf = csrfMatch[1];

	// Extract session cookie from login page response
	const setCookies = loginPage.headers.getSetCookie?.() ?? [];
	const sessionCookie = setCookies.find(c => c.startsWith('session='));
	const cookieVal = sessionCookie?.split(';')[0] ?? '';

	// Step 2: POST /login with credentials
	if (!user || !pass) throw new Error('Calibre username and password are required');
	const body = new URLSearchParams({
		username: user,
		password: pass,
		csrf_token: csrf,
		next: '/',
		remember_me: 'on',
		submit: ''
	});
	const loginRes = await fetch(`${config.url}/login`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Cookie: cookieVal
		},
		body: body.toString(),
		redirect: 'manual',
		signal: AbortSignal.timeout(8000)
	});

	// Successful login returns 302 redirect to /; failed returns 200 (login page again)
	if (loginRes.status !== 302) {
		throw new Error('Calibre login failed: wrong username or password');
	}

	// Get the new session cookie from login response
	const postCookies = loginRes.headers.getSetCookie?.() ?? [];
	const newSession = postCookies.find(c => c.startsWith('session='));
	const finalCookie = newSession?.split(';')[0] ?? cookieVal;

	if (!finalCookie) throw new Error('No session cookie received');

	// Cache for 55 minutes (Flask default session is 60min)
	sessionCache.set(cacheKey, { cookie: finalCookie, expiresAt: Date.now() + 55 * 60_000 });
	return finalCookie;
}

interface CalibreBook {
	id: number;
	title: string;
	authors: string;
	author_sort: string;
	comments: string;
	tags: string;
	series: string;
	series_index: number;
	publishers: string;
	languages: string;
	ratings: string;
	has_cover: number;
	pubdate: string;
	read_status: boolean;
	is_archived: boolean;
	data: string;
	uuid: string;
	path: string;
	sort: string;
}

interface CalibreListResponse {
	totalNotFiltered: number;
	total: number;
	rows: CalibreBook[];
}

async function calibreFetch(config: ServiceConfig, path: string, userCred?: UserCredential): Promise<Response> {
	const cookie = await getSession(config, userCred);
	const res = await fetch(`${config.url}${path}`, {
		headers: { Cookie: cookie },
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`Calibre ${path} -> ${res.status}`);
	// Calibre-Web sometimes returns 200 with an HTML login page instead of 401
	const contentType = res.headers.get('content-type') ?? '';
	if (!contentType.includes('json') && path.includes('/ajax/')) {
		throw new Error(`Calibre authentication failed — got HTML instead of JSON. Check your credentials.`);
	}
	return res;
}

async function fetchBooks(
	config: ServiceConfig,
	opts: { offset?: number; limit?: number; sort?: string; order?: string; search?: string },
	userCred?: UserCredential
): Promise<CalibreListResponse> {
	const params = new URLSearchParams({
		offset: String(opts.offset ?? 0),
		limit: String(opts.limit ?? 50),
		sort: opts.sort ?? 'id',
		order: opts.order ?? 'desc'
	});
	if (opts.search) params.set('search', opts.search);
	const res = await calibreFetch(config, `/ajax/listbooks?${params}`, userCred);
	return res.json() as Promise<CalibreListResponse>;
}

// ---------------------------------------------------------------------------
// Normalize a Calibre book JSON to UnifiedMedia
// ---------------------------------------------------------------------------

function normalize(config: ServiceConfig, book: CalibreBook): UnifiedMedia {
	const bookId = String(book.id);

	// Tags -> genres
	const genres = book.tags ? book.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

	// Rating — Calibre uses "★★★★" string or empty
	const starMatch = book.ratings?.match(/★/g);
	const rating = starMatch ? starMatch.length * 2 : undefined;

	// Description — strip HTML from comments
	let description: string | undefined;
	if (book.comments) {
		description = book.comments
			.replace(/<[^>]+>/g, ' ')
			.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
			.replace(/&#34;/g, '"').replace(/&#39;/g, "'")
			.replace(/\s+/g, ' ')
			.trim();
	}

	// Year from pubdate
	const year = book.pubdate ? new Date(book.pubdate).getFullYear() : undefined;

	// Cover
	// Calibre-Web cover URLs require auth — proxy through Nexus
	const poster = book.has_cover
		? `/api/media/image?service=${encodeURIComponent(config.id)}&path=${encodeURIComponent(`/cover/${book.id}`)}`
		: undefined;

	// Calibre-Web's /ajax/listbooks serializes the `data` relationship via
	// Data.get() which returns filenames, NOT format names. Format discovery
	// requires scraping /book/{id} — done by getCalibreBookFormats().
	// Count entries to know how many formats exist (used as a hint).
	const formatCount = book.data ? book.data.split(',').filter(Boolean).length : 0;

	return {
		id: `${bookId}:${config.id}`,
		sourceId: bookId,
		serviceId: config.id,
		serviceType: 'calibre',
		type: 'book',
		title: book.title,
		description,
		poster,
		year: year && !isNaN(year) ? year : undefined,
		rating,
		genres,
		status: book.read_status ? 'completed' : 'available',
		metadata: {
			calibreId: bookId,
			author: book.authors,
			authorSort: book.author_sort || undefined,
			publisher: book.publishers || undefined,
			language: book.languages !== 'Unknown' ? book.languages : undefined,
			seriesName: book.series || undefined,
			seriesIndex: book.series_index || undefined,
			readStatus: book.read_status,
			uuid: book.uuid,
			formatCount
		},
		actionLabel: 'Read',
		actionUrl: `/books/read/${book.id}?service=${config.id}`,
		streamUrl: formatCount > 0 ? `/api/books/${book.id}/read` : undefined
	};
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

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
		supportsAutoAuth: true,
	},

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			const data = await fetchBooks(config, { limit: 1 });
			if (typeof data.total !== 'number') throw new Error('Unexpected response');
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

	async getContinueWatching(config, userCred): Promise<UnifiedMedia[]> {
		try {
			// Calibre-Web doesn't expose per-page reading progress via its AJAX API.
			// Approximate "currently reading" by fetching unread books sorted by most
			// recently modified (last_modified reflects read-status toggles and annotation
			// changes). Books that are not yet marked as read are treated as in-progress.
			const data = await fetchBooks(config, { limit: 20, sort: 'last_modified', order: 'desc' }, userCred);
			return data.rows
				.filter(b => !b.read_status)
				.slice(0, 10)
				.map(b => {
					const item = normalize(config, b);
					// No granular progress available — set a nominal value to indicate "started"
					item.progress = 0.05;
					return item;
				});
		} catch {
			return [];
		}
	},

	async getRecentlyAdded(config, userCred): Promise<UnifiedMedia[]> {
		try {
			const data = await fetchBooks(config, { limit: 20, sort: 'id', order: 'desc' }, userCred);
			return data.rows.map(b => normalize(config, b));
		} catch {
			return [];
		}
	},

	async search(config, query, userCred): Promise<UnifiedSearchResult> {
		try {
			const data = await fetchBooks(config, { limit: 50, search: query }, userCred);
			const items = data.rows.map(b => normalize(config, b));
			return { items, total: data.total, source: 'calibre' };
		} catch {
			return { items: [], total: 0, source: 'calibre' };
		}
	},

	async getItem(config, sourceId, userCred): Promise<UnifiedMedia | null> {
		try {
			// Fetch the specific book by searching with its ID
			const data = await fetchBooks(config, { limit: 1, search: sourceId }, userCred);
			const book = data.rows.find(b => String(b.id) === sourceId);
			if (book) return normalize(config, book);
			// Fallback: fetch all and find
			const all = await fetchBooks(config, { limit: 5000 }, userCred);
			const match = all.rows.find(b => String(b.id) === sourceId);
			return match ? normalize(config, match) : null;
		} catch {
			return null;
		}
	},

	async getLibrary(config, opts, userCred): Promise<{ items: UnifiedMedia[]; total: number }> {
		try {
			const sortMap: Record<string, string> = {
				title: 'sort',
				year: 'pubdate',
				rating: 'ratings',
				added: 'id'
			};
			const sort = sortMap[opts?.sortBy ?? 'title'] ?? 'sort';
			const order = (opts?.sortBy === 'added' || opts?.sortBy === 'year') ? 'desc' : 'asc';
			const data = await fetchBooks(config, {
				offset: opts?.offset ?? 0,
				limit: opts?.limit ?? 50,
				sort,
				order
			}, userCred);
			return {
				items: data.rows.map(b => normalize(config, b)),
				total: data.total
			};
		} catch {
			return { items: [], total: 0 };
		}
	},

	async authenticateUser(config, username, password) {
		// Test login by getting a session
		const testConfig = { ...config, username, password };
		await getSession(testConfig);
		return {
			accessToken: password,
			externalUserId: username,
			externalUsername: username
		};
	},

	async createUser(config, username, password) {
		// 1. Get admin session
		const cookie = await getSession(config);

		// 2. GET the new-user form to extract CSRF token and default values
		const formRes = await fetch(`${config.url}/admin/user/new`, {
			headers: { Cookie: cookie },
			signal: AbortSignal.timeout(8000)
		});
		if (!formRes.ok) throw new Error(`Calibre admin user form failed: ${formRes.status}`);
		const html = await formRes.text();
		const csrfMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/);
		if (!csrfMatch) throw new Error('Could not find CSRF token on admin user form — is the admin account configured correctly?');

		// Extract default_language and locale from the form's selected options
		const defaultLang = html.match(/name="default_language"[^>]*>[\s\S]*?<option[^>]*selected[^>]*value="([^"]*)"/)?.[1]
			?? html.match(/id="default_language"[^>]*>[\s\S]*?<option[^>]*selected[^>]*value="([^"]*)"/)?.[1]
			?? 'all';
		const locale = html.match(/name="locale"[^>]*>[\s\S]*?<option[^>]*selected[^>]*value="([^"]*)"/)?.[1]
			?? html.match(/id="locale"[^>]*>[\s\S]*?<option[^>]*selected[^>]*value="([^"]*)"/)?.[1]
			?? 'en';

		// 3. POST to create the user
		// Calibre-Web requires: name, email, password, default_language, locale
		const body = new URLSearchParams({
			name: username,
			password: password,
			email: `${username}@nexus.local`,
			default_language: defaultLang,
			locale: locale,
			csrf_token: csrfMatch[1]
		});
		const createRes = await fetch(`${config.url}/admin/user/new`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Cookie: cookie
			},
			body: body.toString(),
			redirect: 'manual',
			signal: AbortSignal.timeout(10000)
		});

		// Calibre-Web returns 200 for both success and failure — check flash messages in response
		const resHtml = createRes.status === 200 ? await createRes.text() : '';
		const created = resHtml.includes('created') && resHtml.includes('alert-success');
		const alreadyExists = resHtml.includes('existing account') || resHtml.includes('already exists');

		if (createRes.status === 200 && !created && !alreadyExists) {
			if (resHtml.includes('Please complete all fields')) {
				throw new Error('Calibre user creation failed — missing required fields');
			}
			throw new Error('Calibre user creation failed — check admin credentials and permissions');
		}

		if (alreadyExists) {
			// User already exists in Calibre — try to authenticate with the provided password.
			// This works when provisioning at registration time (password matches).
			// For admin-triggered provisioning with random passwords, this will fail gracefully.
			try {
				const testConfig = { ...config, username, password };
				await getSession(testConfig);
				return { accessToken: password, externalUserId: username, externalUsername: username };
			} catch {
				throw new Error(`Calibre user "${username}" already exists — link manually via My Accounts`);
			}
		}

		// Verify by authenticating as the new user
		const testConfig = { ...config, username, password };
		await getSession(testConfig);

		return {
			accessToken: password,
			externalUserId: username,
			externalUsername: username
		};
	},

	async getImageHeaders(config, userCred): Promise<Record<string, string>> {
		try {
			const cookie = await getSession(config, userCred);
			return { Cookie: cookie };
		} catch {
			return {};
		}
	},

	async getServiceData(config, dataType, _params, userCred) {
		switch (dataType) {
			case 'series': return getCalibreSeries(config, userCred);
			case 'all': return getAllBooks(config, userCred);
			case 'categories': return getCalibreCategories(config, userCred);
			case 'authors': return getCalibreAuthors(config, userCred);
			default: return null;
		}
	},

	async enrichItem(config, item, enrichmentType, userCred) {
		if (enrichmentType === 'formats') return { ...item, metadata: { ...item.metadata, formats: await getCalibreBookFormats(config, item.sourceId, userCred) } };
		if (enrichmentType === 'related') return { ...item, metadata: { ...item.metadata, related: await getRelatedBooks(config, item.sourceId, userCred) } };
		return item;
	},

	async setItemStatus(config, sourceId, status, userCred) {
		if ((status as Record<string, unknown>).read != null) await toggleReadStatus(config, sourceId, userCred);
	},

	async downloadContent(config, sourceId, format, userCred) {
		return downloadBook(config, sourceId, format!, userCred);
	}
};

// ---------------------------------------------------------------------------
// Exported helpers for book enrichment
// ---------------------------------------------------------------------------

export interface CalibreSeries {
	name: string;
	books: UnifiedMedia[];
}

export async function getCalibreSeries(config: ServiceConfig, userCred?: UserCredential): Promise<CalibreSeries[]> {
	return withCache(`calibre-series:${config.id}`, 300_000, async () => {
		try {
			const data = await fetchBooks(config, { limit: 5000, sort: 'sort', order: 'asc' }, userCred);
			const seriesMap = new Map<string, UnifiedMedia[]>();
			for (const book of data.rows) {
				if (!book.series) continue;
				const item = normalize(config, book);
				const existing = seriesMap.get(book.series) ?? [];
				existing.push(item);
				seriesMap.set(book.series, existing);
			}
			return Array.from(seriesMap.entries()).map(([name, books]) => ({ name, books }));
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
			const data = await fetchBooks(config, { limit: 5000 }, userCred);
			const authorMap = new Map<string, number>();
			for (const book of data.rows) {
				if (book.authors) {
					const name = book.authors.trim();
					authorMap.set(name, (authorMap.get(name) ?? 0) + 1);
				}
			}
			return Array.from(authorMap.entries())
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
			const data = await fetchBooks(config, { limit: 5000 }, userCred);
			const tags = new Set<string>();
			for (const book of data.rows) {
				if (book.tags) {
					book.tags.split(',').forEach(t => { const trimmed = t.trim(); if (trimmed) tags.add(trimmed); });
				}
			}
			return Array.from(tags).sort();
		} catch {
			return [];
		}
	});
}

export interface CalibreBookFormats {
	formats: { name: string; downloadUrl: string }[];
}

export async function getCalibreBookFormats(
	config: ServiceConfig,
	bookId: string,
	userCred?: UserCredential
): Promise<CalibreBookFormats> {
	try {
		// Scrape the book detail page for download links — the only reliable
		// way to discover formats in Calibre-Web (the AJAX API doesn't expose them)
		const res = await calibreFetch(config, `/book/${bookId}`, userCred);
		const html = await res.text();
		const dlMatches = html.match(/\/download\/\d+\/([a-z0-9]+)/gi);
		if (!dlMatches) return { formats: [] };
		const seen = new Set<string>();
		const formats: { name: string; downloadUrl: string }[] = [];
		for (const m of dlMatches) {
			const fmt = m.split('/').pop()!.toLowerCase();
			if (!seen.has(fmt)) {
				seen.add(fmt);
				formats.push({ name: fmt.toUpperCase(), downloadUrl: `/api/books/${bookId}/download/${fmt}` });
			}
		}
		return { formats };
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
		const data = await fetchBooks(config, { limit: 5000, sort: 'sort', order: 'asc' }, userCred);
		const currentBook = data.rows.find(b => String(b.id) === bookId);
		if (!currentBook) return { sameAuthor: [], sameSeries: [] };

		const sameAuthor: UnifiedMedia[] = [];
		const sameSeries: UnifiedMedia[] = [];
		let nextInSeries: UnifiedMedia | undefined;
		let prevInSeries: UnifiedMedia | undefined;

		for (const book of data.rows) {
			if (String(book.id) === bookId) continue;
			const item = normalize(config, book);

			if (book.authors === currentBook.authors) {
				sameAuthor.push(item);
			}
			if (currentBook.series && book.series === currentBook.series) {
				sameSeries.push(item);
				if (book.series_index === currentBook.series_index + 1) nextInSeries = item;
				if (book.series_index === currentBook.series_index - 1) prevInSeries = item;
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
	const cookie = await getSession(config, userCred);
	const res = await fetch(`${config.url}/ajax/toggleread/${bookId}`, {
		method: 'POST',
		headers: { Cookie: cookie },
		signal: AbortSignal.timeout(8000)
	});
	return res.ok;
}

export async function downloadBook(
	config: ServiceConfig,
	bookId: string,
	format: string,
	userCred?: UserCredential
): Promise<Response> {
	const cookie = await getSession(config, userCred);
	// Calibre-Web download URL pattern
	const res = await fetch(`${config.url}/download/${bookId}/${format.toLowerCase()}`, {
		headers: { Cookie: cookie },
		signal: AbortSignal.timeout(30000),
		redirect: 'follow'
	});
	if (!res.ok) throw new Error(`Download failed: ${res.status}`);
	return res;
}

/** Fetch all books (cached) for building enrichment data */
export async function getAllBooks(
	config: ServiceConfig,
	userCred?: UserCredential
): Promise<UnifiedMedia[]> {
	return withCache(`calibre-allbooks:${config.id}`, 300_000, async () => {
		try {
			const data = await fetchBooks(config, { limit: 5000, sort: 'sort', order: 'asc' }, userCred);
			return data.rows.map(b => normalize(config, b));
		} catch {
			return [];
		}
	});
}
