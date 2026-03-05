import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, UserCredential, ExternalUser } from './types';
import { withCache } from '../server/cache';

// ---------------------------------------------------------------------------
// Authenticated fetch — uses per-user Basic auth when available,
// falls back to server-level apiKey or config username/password.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rommFetch(config: ServiceConfig, path: string, userCred?: UserCredential, init?: RequestInit): Promise<any> {
	const url = `${config.url}/api${path}`;
	const headers: Record<string, string> = {
		...(init?.headers as Record<string, string> ?? {})
	};

	// Don't send Content-Type for GET (only needed for POST/PUT with body)
	if (init?.body) {
		headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
	}

	// Auth priority: user credential (Basic) > user token (Bearer) > apiKey > config creds (Basic)
	if (userCred?.externalUsername && userCred?.accessToken) {
		// accessToken stores the password for Basic auth
		headers['Authorization'] = 'Basic ' + btoa(`${userCred.externalUsername}:${userCred.accessToken}`);
	} else if (config.apiKey) {
		headers['Authorization'] = `Bearer ${config.apiKey}`;
	} else if (config.username && config.password) {
		headers['Authorization'] = 'Basic ' + btoa(`${config.username}:${config.password}`);
	}

	const res = await fetch(url, {
		...init,
		headers,
		signal: init?.signal ?? AbortSignal.timeout(8000)
	});

	if (!res.ok) throw new Error(`RomM ${path} -> ${res.status}`);
	return res.json();
}

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(config: ServiceConfig, item: any): UnifiedMedia {
	let year: number | undefined;
	const releaseDate = item.metadatum?.first_release_date ?? item.first_release_date;
	if (releaseDate) {
		year = typeof releaseDate === 'number'
			? new Date(releaseDate * 1000).getFullYear()
			: new Date(releaseDate).getFullYear();
	}

	const rawRating = item.metadatum?.average_rating ?? item.total_rating;
	const rating = rawRating != null
		? (rawRating > 10 ? rawRating / 10 : rawRating)
		: undefined;

	const genres = (item.metadatum?.genres ?? item.genres ?? [])
		.map((g: { name?: string } | string) => typeof g === 'string' ? g : g.name)
		.filter(Boolean) as string[];

	const poster = item.url_cover
		?? (item.path_cover_large ? `${config.url}${item.path_cover_large}` : undefined)
		?? item.cover_url;

	const screenshots = item.merged_screenshots ?? item.screenshots ?? [];
	const backdrop = screenshots[0]?.url ?? screenshots[0]?.full_url ?? undefined;

	return {
		id: `${item.id}:${config.id}`,
		sourceId: String(item.id),
		serviceId: config.id,
		serviceType: 'romm',
		type: 'game',
		title: item.name || item.fs_name_no_ext || item.fs_name || 'Unknown',
		sortTitle: item.name,
		description: item.summary ?? item.metadatum?.summary,
		poster,
		backdrop,
		year,
		rating,
		genres,
		status: 'available',
		metadata: {
			rommId: item.id,
			platform: item.platform_display_name ?? item.platform_name,
			platformSlug: item.platform_slug,
			platformId: item.platform_id,
			fileSize: item.fs_size_bytes ?? item.file_size_bytes,
			regions: item.regions,
			userStatus: item.rom_user?.status,
			lastPlayed: item.rom_user?.last_played,
			retroAchievements: item.merged_ra_metadata,
			hltb: item.hltb_metadata,
			fileName: item.fs_name,
			tags: item.tags
		},
		actionLabel: 'Play',
		actionUrl: `${config.url}/rom/${item.id}`
	};
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

export interface RommPlatform {
	id: number;
	display_name: string;
	slug: string;
	rom_count: number;
	url_logo?: string;
}

export async function getPlatforms(config: ServiceConfig, userCred?: UserCredential): Promise<RommPlatform[]> {
	return withCache(`romm-platforms:${config.id}`, 300_000, async () => {
		try {
			const data = await rommFetch(config, '/platforms', userCred);
			return (Array.isArray(data) ? data : data?.items ?? []).map((p: RommPlatform) => ({
				id: p.id,
				display_name: p.display_name,
				slug: p.slug,
				rom_count: p.rom_count,
				url_logo: p.url_logo
			}));
		} catch {
			return [];
		}
	});
}

export interface RommCollection {
	id: number;
	name: string;
	description?: string;
	rom_count: number;
	roms: number[];
}

export async function getCollections(config: ServiceConfig, userCred?: UserCredential): Promise<RommCollection[]> {
	return withCache(`romm-collections:${config.id}`, 300_000, async () => {
		try {
			const data = await rommFetch(config, '/collections', userCred);
			return Array.isArray(data) ? data : data?.items ?? [];
		} catch {
			return [];
		}
	});
}

// ---------------------------------------------------------------------------
// Sort mapping
// ---------------------------------------------------------------------------

const SORT_MAP: Record<string, string> = {
	title: 'name',
	year: 'first_release_date',
	rating: 'name',
	added: 'created_at'
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const rommAdapter: ServiceAdapter = {
	id: 'romm',
	displayName: 'RomM',
	defaultPort: 8080,
	icon: 'romm',
	mediaTypes: ['game'],
	userLinkable: true,

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			// Heartbeat is public — no auth needed
			const url = `${config.url}/api/heartbeat`;
			const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
			if (!res.ok) throw new Error(`${res.status}`);
			return {
				serviceId: config.id,
				name: config.name,
				type: 'romm',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'romm',
				online: false,
				error: String(e)
			};
		}
	},

	async getRecentlyAdded(config, userCred): Promise<UnifiedMedia[]> {
		try {
			const data = await rommFetch(config, '/roms?order_by=created_at&order_dir=desc&limit=20', userCred);
			return (data?.items ?? data ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	async search(config, query, userCred): Promise<UnifiedSearchResult> {
		try {
			const data = await rommFetch(
				config,
				`/roms?search_term=${encodeURIComponent(query)}&limit=20`,
				userCred
			);
			const items = (data?.items ?? data ?? []).map((i: unknown) => normalize(config, i));
			return { items, total: data?.total ?? items.length, source: 'romm' };
		} catch {
			return { items: [], total: 0, source: 'romm' };
		}
	},

	async getItem(config, sourceId, userCred): Promise<UnifiedMedia | null> {
		try {
			const item = await rommFetch(config, `/roms/${sourceId}`, userCred);
			return normalize(config, item);
		} catch {
			return null;
		}
	},

	async getLibrary(config, opts, userCred): Promise<{ items: UnifiedMedia[]; total: number }> {
		try {
			const limit = opts?.limit ?? 50;
			const offset = opts?.offset ?? 0;
			const orderBy = SORT_MAP[opts?.sortBy ?? ''] ?? 'name';
			const orderDir = opts?.sortBy === 'added' ? 'desc' : 'asc';

			let url = `/roms?limit=${limit}&offset=${offset}&order_by=${orderBy}&order_dir=${orderDir}`;

			const platformId = (opts as any)?.platformId;
			if (platformId) {
				url += `&platform_id=${platformId}`;
			}

			const data = await rommFetch(config, url, userCred);
			const rawItems = data?.items ?? data ?? [];
			const items = rawItems.map((i: unknown) => normalize(config, i));
			return { items, total: data?.total ?? items.length };
		} catch {
			return { items: [], total: 0 };
		}
	},

	async authenticateUser(config, username, password) {
		// RomM supports HTTP Basic — verify credentials by hitting /users/me
		const res = await fetch(`${config.url}/api/users/me`, {
			headers: {
				'Authorization': 'Basic ' + btoa(`${username}:${password}`)
			},
			signal: AbortSignal.timeout(8000)
		});

		if (!res.ok) throw new Error(`RomM auth failed: ${res.status}`);
		const me = await res.json();

		return {
			// Store password as accessToken so rommFetch can use Basic auth
			accessToken: password,
			externalUserId: String(me.id),
			externalUsername: me.username ?? username
		};
	},

	async createUser(config, username, password) {
		const createRes = await rommFetch(config, '/users', undefined, {
			method: 'POST',
			body: JSON.stringify({
				username,
				password,
				email: '',
				role: 'viewer'
			})
		});

		const userId = String(createRes.id ?? createRes.user_id);

		return {
			accessToken: password,
			externalUserId: userId,
			externalUsername: username
		};
	},

	async getUsers(config): Promise<ExternalUser[]> {
		try {
			const data = await rommFetch(config, '/users');
			const users = Array.isArray(data) ? data : data?.items ?? [];
			return users.map((u: { id: number; username: string; enabled?: boolean; role?: string }) => ({
				externalId: String(u.id),
				username: u.username,
				isAdmin: u.role === 'admin',
				serviceType: 'romm'
			}));
		} catch {
			return [];
		}
	}
};
