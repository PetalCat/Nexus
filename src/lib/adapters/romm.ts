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
// Field normalization helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeHltb(raw: any): { main?: number; extra?: number; completionist?: number } | undefined {
	if (!raw) return undefined;
	// RomM stores HLTB times in centiseconds (from HLTB API)
	// Convert to minutes for display
	const toMinutes = (cs?: number) => cs && cs > 0 ? Math.round(cs / 6000) : undefined;
	const result = {
		main: toMinutes(raw.main_story),
		extra: toMinutes(raw.main_plus_extra),
		completionist: toMinutes(raw.completionist)
	};
	return (result.main || result.extra || result.completionist) ? result : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRA(raw: any): { achievements: Array<{ title: string; description?: string; badge_url?: string; points?: number }>; completion_percentage?: number } | undefined {
	if (!raw) return undefined;
	// merged_ra_metadata may be an object with achievements array, or progression data
	const achievements = (raw.achievements ?? raw.ra_metadata?.achievements ?? [])
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.map((a: any) => ({
			title: a.title ?? 'Unknown',
			description: a.description,
			badge_url: a.badge_url,
			points: a.points
		}));
	// Progression: num_awarded / max_possible
	let completion_percentage: number | undefined;
	if (raw.num_awarded != null && raw.max_possible != null && raw.max_possible > 0) {
		completion_percentage = Math.round((raw.num_awarded / raw.max_possible) * 100);
	}
	return achievements.length > 0 || completion_percentage != null
		? { achievements, completion_percentage }
		: undefined;
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

	const rawPoster = (item.url_cover || undefined)
		?? (item.path_cover_large || undefined)
		?? (item.path_cover_small || undefined)
		?? (item.cover_url || undefined);

	// Cover URLs from RomM require auth — proxy through Nexus
	const poster = rawPoster
		? (rawPoster.startsWith('http')
			? rawPoster
			: `/api/media/image?service=${encodeURIComponent(config.id)}&path=${encodeURIComponent(rawPoster)}`)
		: undefined;

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
			is_favorited: item.rom_user?.is_favorited ?? false,
			lastPlayed: item.rom_user?.last_played,
			retroAchievements: normalizeRA(item.merged_ra_metadata),
			hltb: normalizeHltb(item.hltb_metadata),
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

export async function getCollection(config: ServiceConfig, collectionId: number, userCred?: UserCredential): Promise<RommCollection | null> {
	try {
		return await rommFetch(config, `/collections/${collectionId}`, userCred);
	} catch {
		return null;
	}
}

export async function createCollection(
	config: ServiceConfig,
	name: string,
	description: string | undefined,
	userCred?: UserCredential
): Promise<RommCollection> {
	return rommFetch(config, '/collections', userCred, {
		method: 'POST',
		body: JSON.stringify({ name, description: description ?? '' })
	});
}

export async function updateCollection(
	config: ServiceConfig,
	collectionId: number,
	data: { name?: string; description?: string },
	userCred?: UserCredential
): Promise<RommCollection> {
	return rommFetch(config, `/collections/${collectionId}`, userCred, {
		method: 'PUT',
		body: JSON.stringify(data)
	});
}

export async function deleteCollection(
	config: ServiceConfig,
	collectionId: number,
	userCred?: UserCredential
): Promise<boolean> {
	try {
		await rommFetch(config, `/collections/${collectionId}`, userCred, {
			method: 'DELETE'
		});
		return true;
	} catch {
		return false;
	}
}

export async function updateCollectionRoms(
	config: ServiceConfig,
	collectionId: number,
	romIds: number[],
	userCred?: UserCredential
): Promise<RommCollection> {
	return rommFetch(config, `/collections/${collectionId}`, userCred, {
		method: 'PUT',
		body: JSON.stringify({ roms: romIds })
	});
}

// ---------------------------------------------------------------------------
// Game detail helpers (saves, states, screenshots, user status)
// ---------------------------------------------------------------------------

export interface RommSave {
	id: number;
	rom_id: number;
	file_name: string;
	file_size_bytes: number;
	download_path?: string;
	screenshot?: { download_path?: string } | null;
	screenshot_url?: string;
	created_at: string;
	updated_at: string;
	emulator?: string;
	slot?: string;
}

export interface RommState {
	id: number;
	rom_id: number;
	file_name: string;
	file_size_bytes: number;
	download_path?: string;
	screenshot?: { download_path?: string } | null;
	screenshot_url?: string;
	created_at: string;
	updated_at: string;
	emulator?: string;
}

export interface RommScreenshot {
	id: number;
	rom_id: number;
	file_name: string;
	url: string;
	created_at: string;
}

export async function getRomSaves(config: ServiceConfig, romId: string | number, userCred?: UserCredential): Promise<RommSave[]> {
	try {
		const data = await rommFetch(config, `/saves?rom_id=${romId}`, userCred);
		const saves = Array.isArray(data) ? data : data?.items ?? [];
		return saves.map((s: any) => ({
			...s,
			screenshot_url: s.screenshot?.download_path
				? `${config.url}${s.screenshot.download_path}`
				: undefined
		} as RommSave));
	} catch {
		return [];
	}
}

export async function getRomStates(config: ServiceConfig, romId: string | number, userCred?: UserCredential): Promise<RommState[]> {
	try {
		const data = await rommFetch(config, `/states?rom_id=${romId}`, userCred);
		const states = Array.isArray(data) ? data : data?.items ?? [];
		return states.map((s: any) => ({
			...s,
			screenshot_url: s.screenshot?.download_path
				? `${config.url}${s.screenshot.download_path}`
				: undefined
		} as RommState));
	} catch {
		return [];
	}
}

export async function getRomScreenshots(config: ServiceConfig, romId: string | number, userCred?: UserCredential): Promise<RommScreenshot[]> {
	try {
		const data = await rommFetch(config, `/roms/${romId}/screenshots`, userCred);
		return Array.isArray(data) ? data : data?.items ?? [];
	} catch {
		return [];
	}
}

export async function updateUserRomStatus(
	config: ServiceConfig,
	romId: string | number,
	status: string,
	userCred?: UserCredential
): Promise<boolean> {
	try {
		await rommFetch(config, `/roms/${romId}/user`, userCred, {
			method: 'PUT',
			body: JSON.stringify({ status })
		});
		return true;
	} catch {
		return false;
	}
}

export async function toggleRomFavorite(
	config: ServiceConfig,
	romId: string | number,
	favorite: boolean,
	userCred?: UserCredential
): Promise<boolean> {
	try {
		await rommFetch(config, `/roms/${romId}/user`, userCred, {
			method: 'PUT',
			body: JSON.stringify({ is_favorited: favorite })
		});
		return true;
	} catch {
		return false;
	}
}

export function getRomDownloadUrl(config: ServiceConfig, romId: string | number, fileName?: string): string {
	if (fileName) {
		return `${config.url}/api/roms/${romId}/content/${encodeURIComponent(fileName)}`;
	}
	return `${config.url}/api/roms/${romId}/content`;
}

// ---------------------------------------------------------------------------
// Binary content helpers (ROM download, save/state CRUD)
// ---------------------------------------------------------------------------

function rommAuthHeaders(config: ServiceConfig, userCred?: UserCredential): Record<string, string> {
	const headers: Record<string, string> = {};
	if (userCred?.externalUsername && userCred?.accessToken) {
		headers['Authorization'] = 'Basic ' + btoa(`${userCred.externalUsername}:${userCred.accessToken}`);
	} else if (config.apiKey) {
		headers['Authorization'] = `Bearer ${config.apiKey}`;
	} else if (config.username && config.password) {
		headers['Authorization'] = 'Basic ' + btoa(`${config.username}:${config.password}`);
	}
	return headers;
}

export async function downloadRomContent(
	config: ServiceConfig,
	romId: string | number,
	userCred?: UserCredential,
	range?: string
): Promise<Response> {
	const headers: Record<string, string> = rommAuthHeaders(config, userCred);

	// RomM requires the filename in the content path — fetch ROM metadata first
	const romData = await rommFetch(config, `/roms/${romId}`, userCred);
	const fileName = romData?.fs_name ?? romData?.file_name ?? '';
	if (!fileName) {
		return new Response('ROM filename not found', { status: 404 });
	}

	if (range) headers['Range'] = range;

	return fetch(`${config.url}/api/roms/${romId}/content/${encodeURIComponent(fileName)}`, {
		headers,
		signal: AbortSignal.timeout(120_000)
	});
}

export async function uploadRomState(
	config: ServiceConfig,
	romId: string | number,
	stateBlob: Blob,
	fileName: string,
	userCred?: UserCredential,
	screenshotBlob?: Blob
): Promise<boolean> {
	try {
		const form = new FormData();
		form.append('stateFile', stateBlob, fileName);
		if (screenshotBlob) {
			form.append('screenshotFile', screenshotBlob, 'screenshot.png');
		}
		const headers = rommAuthHeaders(config, userCred);

		const res = await fetch(`${config.url}/api/states?rom_id=${romId}`, {
			method: 'POST',
			headers,
			body: form,
			signal: AbortSignal.timeout(30_000)
		});
		return res.ok;
	} catch {
		return false;
	}
}

export async function uploadRomSave(
	config: ServiceConfig,
	romId: string | number,
	saveBlob: Blob,
	fileName: string,
	userCred?: UserCredential,
	screenshotBlob?: Blob
): Promise<boolean> {
	try {
		const form = new FormData();
		form.append('saveFile', saveBlob, fileName);
		if (screenshotBlob) {
			form.append('screenshotFile', screenshotBlob, 'screenshot.png');
		}
		const headers = rommAuthHeaders(config, userCred);

		const res = await fetch(`${config.url}/api/saves?rom_id=${romId}`, {
			method: 'POST',
			headers,
			body: form,
			signal: AbortSignal.timeout(30_000)
		});
		return res.ok;
	} catch {
		return false;
	}
}

export async function downloadRomState(
	config: ServiceConfig,
	romId: string | number,
	stateId: string | number,
	userCred?: UserCredential
): Promise<Response> {
	const headers = rommAuthHeaders(config, userCred);
	// Fetch state metadata to get download_path
	const meta = await rommFetch(config, `/states/${stateId}`, userCred);
	const dlPath = meta?.download_path;
	if (!dlPath) {
		return new Response('State download path not found', { status: 404 });
	}
	// download_path is an absolute path like "/api/states/{id}/content/{filename}"
	return fetch(`${config.url}${dlPath}`, {
		headers,
		signal: AbortSignal.timeout(30_000)
	});
}

export async function deleteRomState(
	config: ServiceConfig,
	_romId: string | number,
	stateId: string | number,
	userCred?: UserCredential
): Promise<boolean> {
	try {
		const headers = rommAuthHeaders(config, userCred);
		headers['Content-Type'] = 'application/json';
		const res = await fetch(`${config.url}/api/states/delete`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ states: [Number(stateId)] }),
			signal: AbortSignal.timeout(8000)
		});
		return res.ok;
	} catch {
		return false;
	}
}

export async function downloadRomSave(
	config: ServiceConfig,
	_romId: string | number,
	saveId: string | number,
	userCred?: UserCredential
): Promise<Response> {
	const headers = rommAuthHeaders(config, userCred);
	const meta = await rommFetch(config, `/saves/${saveId}`, userCred);
	const dlPath = meta?.download_path;
	if (!dlPath) {
		return new Response('Save download path not found', { status: 404 });
	}
	return fetch(`${config.url}${dlPath}`, {
		headers,
		signal: AbortSignal.timeout(30_000)
	});
}

export async function deleteRomSave(
	config: ServiceConfig,
	_romId: string | number,
	saveId: string | number,
	userCred?: UserCredential
): Promise<boolean> {
	try {
		const headers = rommAuthHeaders(config, userCred);
		headers['Content-Type'] = 'application/json';
		const res = await fetch(`${config.url}/api/saves/delete`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ saves: [Number(saveId)] }),
			signal: AbortSignal.timeout(8000)
		});
		return res.ok;
	} catch {
		return false;
	}
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
	color: '#e84393',
	abbreviation: 'RM',
	isLibrary: true,
	isSearchable: true,
	searchPriority: 0,
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

			const platformId = opts?.platformId;
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
