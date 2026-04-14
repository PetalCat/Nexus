import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth } from './types';
import { withCache } from '../server/cache';

const capabilityBackoffUntil = new Map<string, number>();

class BazarrCapabilityError extends Error {
	constructor(
		message: string,
		readonly capabilityKey: string
	) {
		super(message);
		this.name = 'BazarrCapabilityError';
	}
}

function getCapabilityCacheKey(config: ServiceConfig, capability: string) {
	return `${config.id}:${capability}`;
}

function isCapabilityBackedOff(config: ServiceConfig, capability: string) {
	const key = getCapabilityCacheKey(config, capability);
	const until = capabilityBackoffUntil.get(key);
	if (!until) return false;
	if (until <= Date.now()) {
		capabilityBackoffUntil.delete(key);
		return false;
	}
	return true;
}

function backOffCapability(config: ServiceConfig, capability: string, ms = 10 * 60 * 1000) {
	capabilityBackoffUntil.set(getCapabilityCacheKey(config, capability), Date.now() + ms);
}

function isBazarrCapabilityError(error: unknown): error is BazarrCapabilityError {
	return error instanceof BazarrCapabilityError;
}

// ---------------------------------------------------------------------------
// Bazarr adapter
//
// Bazarr is a subtitle management companion for Sonarr and Radarr. It
// automatically downloads and manages subtitles for your media library.
//
// Config convention:
//   url    -> Bazarr instance URL (e.g. http://localhost:6767)
//   apiKey -> Bazarr API key (Settings > General > Security > API Key)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubtitleTrack {
	language: string;
	languageName: string;
	hearingImpaired: boolean;
	forced: boolean;
	provider?: string;
	score?: number;
	filePath?: string;
}

export interface SubtitleStatus {
	tmdbId?: string;
	radarrId?: string;
	sonarrId?: string;
	seriesId?: string;
	seasonNumber?: number;
	episodeNumber?: number;
	title: string;
	available: SubtitleTrack[];
	missing: string[];
	wanted: string[];
}

export interface SubtitleEvent {
	timestamp: string;
	mediaTitle: string;
	episodeInfo?: string;
	language: string;
	provider: string;
	action: 'downloaded' | 'upgraded' | 'failed' | 'deleted' | 'manual';
	score?: number;
}

export interface SubtitleProvider {
	name: string;
	status: 'active' | 'throttled' | 'error' | 'disabled';
	error?: string;
}

export interface LanguageProfile {
	id: number;
	name: string;
	languages: Array<{ code: string; name: string; forced: boolean; hi: boolean }>;
}

// ---------------------------------------------------------------------------
// Internal fetch helper
// ---------------------------------------------------------------------------

async function bazarrFetch(
	config: ServiceConfig,
	path: string,
	opts?: { method?: string; body?: string | FormData; timeoutMs?: number; rawResponse?: boolean }
): Promise<unknown> {
	const capability =
		path.startsWith('/api/history/movies') ? 'history-movies'
		: path.startsWith('/api/history/series') ? 'history-series'
		: null;

	if (capability && isCapabilityBackedOff(config, capability)) {
		throw new BazarrCapabilityError(`Bazarr ${path} temporarily disabled after compatibility failure`, capability);
	}

	const timeoutMs = opts?.timeoutMs ?? 8000;
	const url = `${config.url.replace(/\/+$/, '')}${path}`;
	const headers: Record<string, string> = {
		'X-API-KEY': config.apiKey ?? '',
		Accept: 'application/json'
	};
	// Only set Content-Type for string bodies (FormData sets its own boundary)
	if (typeof opts?.body === 'string') {
		headers['Content-Type'] = 'application/json';
	}
	const res = await fetch(url, {
		method: opts?.method ?? 'GET',
		headers,
		body: opts?.body,
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`Bazarr ${path} -> ${res.status}`);
	if (opts?.rawResponse) return res;
	const text = await res.text();
	if (!text) return {};
	// Detect HTML responses (Bazarr SPA fallback for unknown routes)
	if (text.trimStart().startsWith('<!') || text.trimStart().startsWith('<html')) {
		if (capability) backOffCapability(config, capability);
		throw new Error(`Bazarr ${path} returned HTML instead of JSON — check API version compatibility`);
	}
	return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Normalization helpers (internal)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeTrack(sub: any): SubtitleTrack {
	return {
		language: sub.code2 ?? sub.code3 ?? '',
		languageName: sub.name ?? '',
		hearingImpaired: !!(sub.hi ?? sub.hearing_impaired),
		forced: !!sub.forced,
		provider: sub.provider ?? undefined,
		score: sub.score ?? undefined,
		filePath: sub.path ?? sub.subtitles_path ?? undefined
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeMovieStatus(movie: any): SubtitleStatus {
	const wanted: string[] = (movie.languages ?? []).map(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(l: any) => l.code2 ?? l.code3 ?? ''
	);
	const available: SubtitleTrack[] = (movie.subtitles ?? []).map(normalizeTrack);
	const availableCodes = new Set(available.map((t) => t.language));
	const missing = wanted.filter((code) => !availableCodes.has(code));

	return {
		tmdbId: movie.tmdbId != null ? String(movie.tmdbId) : undefined,
		radarrId: movie.radarrId != null ? String(movie.radarrId) : undefined,
		title: movie.title ?? '',
		available,
		missing,
		wanted
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEpisodeStatus(ep: any): SubtitleStatus {
	const wanted: string[] = (ep.languages ?? []).map(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(l: any) => l.code2 ?? l.code3 ?? ''
	);
	const available: SubtitleTrack[] = (ep.subtitles ?? []).map(normalizeTrack);
	const availableCodes = new Set(available.map((t) => t.language));
	const missing = wanted.filter((code) => !availableCodes.has(code));

	return {
		sonarrId: ep.sonarrSeriesId != null ? String(ep.sonarrSeriesId) : undefined,
		seriesId: ep.seriesId != null ? String(ep.seriesId) : undefined,
		seasonNumber: ep.season ?? undefined,
		episodeNumber: ep.episode ?? undefined,
		title: ep.title ?? '',
		available,
		missing,
		wanted
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeHistoryEvent(entry: any): SubtitleEvent {
	const actionStr = String(entry.action ?? '').toLowerCase();
	let action: SubtitleEvent['action'] = 'downloaded';
	if (actionStr.includes('upgrade')) action = 'upgraded';
	else if (actionStr.includes('fail')) action = 'failed';
	else if (actionStr.includes('delet')) action = 'deleted';
	else if (actionStr.includes('manual')) action = 'manual';

	let episodeInfo: string | undefined;
	if (entry.episode_number != null && entry.season != null) {
		const s = String(entry.season).padStart(2, '0');
		const e = String(entry.episode_number).padStart(2, '0');
		episodeInfo = `S${s}E${e}`;
	}

	const language = entry.language?.code2 ?? entry.language?.name ?? '';

	return {
		timestamp: entry.timestamp ?? '',
		mediaTitle: entry.seriesTitle ?? entry.title ?? '',
		episodeInfo,
		language,
		provider: entry.provider ?? '',
		action,
		score: entry.score ?? undefined
	};
}

// ---------------------------------------------------------------------------
// Exported enrichment helpers
// ---------------------------------------------------------------------------

export async function getSubtitleStatus(
	config: ServiceConfig,
	tmdbId?: string,
	opts?: { radarrId?: string; sonarrId?: string; type?: string }
): Promise<SubtitleStatus | null> {
	const cacheKey = `bazarr:status:${config.id}:${tmdbId ?? ''}:${opts?.radarrId ?? ''}:${opts?.sonarrId ?? ''}:${opts?.type ?? ''}`;

	return withCache<SubtitleStatus | null>(cacheKey, 120_000, async () => {
		const isShow = opts?.type === 'show' || opts?.type === 'episode' || !!opts?.sonarrId;

		// Try TMDB ID first
		if (tmdbId) {
			try {
				if (isShow) {
					const data = (await bazarrFetch(config, `/api/series?tmdbid[]=${tmdbId}`)) as { data?: unknown[] };
					const items = data.data ?? (Array.isArray(data) ? data : []);
					if (items.length > 0) return normalizeEpisodeStatus(items[0]);
				} else {
					const data = (await bazarrFetch(config, `/api/movies?tmdbid[]=${tmdbId}`)) as { data?: unknown[] };
					const items = data.data ?? (Array.isArray(data) ? data : []);
					if (items.length > 0) return normalizeMovieStatus(items[0]);
				}
			} catch { /* fall through to ID lookup */ }
		}

		// Fall back to Radarr/Sonarr ID
		if (opts?.radarrId) {
			try {
				const movie = await bazarrFetch(config, `/api/movies/${opts.radarrId}`);
				return normalizeMovieStatus(movie);
			} catch { /* no match */ }
		}
		if (opts?.sonarrId) {
			try {
				const series = await bazarrFetch(config, `/api/series/${opts.sonarrId}`);
				return normalizeEpisodeStatus(series);
			} catch { /* no match */ }
		}

		return null;
	});
}

export async function getSeasonSubtitleStatus(
	config: ServiceConfig,
	sonarrSeriesId: number,
	seasonNumber: number
): Promise<SubtitleStatus[]> {
	const cacheKey = `bazarr:season:${config.id}:${sonarrSeriesId}:${seasonNumber}`;

	return withCache<SubtitleStatus[]>(cacheKey, 120_000, async () => {
		try {
			const data = (await bazarrFetch(
				config,
				`/api/episodes?seriesid[]=${sonarrSeriesId}`
			)) as { data?: unknown[] };
			const episodes = data.data ?? (Array.isArray(data) ? data : []);
			return episodes
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				.filter((ep: any) => ep.season === seasonNumber)
				.map(normalizeEpisodeStatus);
		} catch (e) {
			console.error(`[Bazarr] getSeasonSubtitleStatus failed:`, e);
			return [];
		}
	});
}

export async function getItemSubtitleHistory(
	config: ServiceConfig,
	tmdbId?: string,
	opts?: { radarrId?: string; sonarrId?: string; type?: string }
): Promise<SubtitleEvent[]> {
	const cacheKey = `bazarr:history:${config.id}:${tmdbId ?? ''}:${opts?.radarrId ?? ''}:${opts?.sonarrId ?? ''}:${opts?.type ?? ''}`;

	return withCache<SubtitleEvent[]>(cacheKey, 120_000, async () => {
		try {
			const isShow = opts?.type === 'show' || opts?.type === 'episode' || !!opts?.sonarrId;
			const endpoint = isShow ? '/api/history/series' : '/api/history/movies';

			const data = (await bazarrFetch(config, endpoint)) as { data?: unknown[] };
			const events = data.data ?? (Array.isArray(data) ? data : []);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const filtered = events.filter((entry: any) => {
				if (tmdbId && String(entry.tmdbId) === tmdbId) return true;
				if (opts?.radarrId && String(entry.radarrId) === opts.radarrId) return true;
				if (opts?.sonarrId && String(entry.sonarrSeriesId) === opts.sonarrId) return true;
				return false;
			});

			return filtered.map(normalizeHistoryEvent);
		} catch (e) {
			if (isBazarrCapabilityError(e)) {
				return [];
			}
			console.error(`[Bazarr] getItemSubtitleHistory failed:`, e);
			return [];
		}
	});
}

// ---------------------------------------------------------------------------
// Exported admin-level functions
// ---------------------------------------------------------------------------

export async function getProviderStatus(config: ServiceConfig): Promise<SubtitleProvider[]> {
	return withCache<SubtitleProvider[]>(`bazarr:providers:${config.id}`, 30_000, async () => {
		try {
			const raw = await bazarrFetch(config, '/api/providers');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const items: any[] = Array.isArray(raw) ? raw : (raw as any).data ?? [];

			return items.map((p) => {
				const rawStatus = String(p.status ?? '').toLowerCase();
				let status: SubtitleProvider['status'] = 'active';
				if (rawStatus.includes('throttl')) status = 'throttled';
				else if (rawStatus.includes('disabled')) status = 'disabled';
				else if (rawStatus.includes('error') || rawStatus.includes('fail')) status = 'error';

				return {
					name: p.name ?? '',
					status,
					error: p.error ?? undefined
				};
			});
		} catch (e) {
			console.error(`[Bazarr] getProviderStatus failed:`, e);
			return [];
		}
	});
}

export async function getLanguageProfiles(config: ServiceConfig): Promise<LanguageProfile[]> {
	return withCache<LanguageProfile[]>(`bazarr:profiles:${config.id}`, 300_000, async () => {
		try {
			const raw = await bazarrFetch(config, '/api/languages/profiles');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const items: any[] = Array.isArray(raw) ? raw : (raw as any).data ?? [];

			return items.map((p) => ({
				id: p.profileId ?? p.id ?? 0,
				name: p.name ?? '',
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				languages: (p.items ?? p.languages ?? []).map((l: any) => ({
					code: l.code2 ?? l.code3 ?? l.language ?? '',
					name: l.name ?? l.long_name ?? '',
					forced: !!l.forced,
					hi: !!l.hi
				}))
			}));
		} catch (e) {
			console.error(`[Bazarr] getLanguageProfiles failed:`, e);
			return [];
		}
	});
}

export async function getSystemHistory(
	config: ServiceConfig,
	opts?: { page?: number; limit?: number }
): Promise<{ events: SubtitleEvent[]; total: number }> {
	const page = opts?.page ?? 1;
	const limit = opts?.limit ?? 25;
	const cacheKey = `bazarr:syshistory:${config.id}:p${page}:l${limit}`;

	return withCache<{ events: SubtitleEvent[]; total: number }>(cacheKey, 30_000, async () => {
		try {
			const start = (page - 1) * limit;
			const [movieRaw, seriesRaw] = await Promise.all([
				bazarrFetch(config, `/api/history/movies?start=${start}&length=${limit}`),
				bazarrFetch(config, `/api/history/series?start=${start}&length=${limit}`)
			]);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const movieData = movieRaw as any;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const seriesData = seriesRaw as any;

			const movieEvents: unknown[] = movieData.data ?? (Array.isArray(movieData) ? movieData : []);
			const seriesEvents: unknown[] = seriesData.data ?? (Array.isArray(seriesData) ? seriesData : []);

			const allEvents = [...movieEvents, ...seriesEvents]
				.map(normalizeHistoryEvent)
				.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0))
				.slice(0, limit);

			const total =
				(movieData.recordsTotal ?? movieEvents.length) +
				(seriesData.recordsTotal ?? seriesEvents.length);

			return { events: allEvents, total };
		} catch (e) {
			if (isBazarrCapabilityError(e)) {
				return { events: [], total: 0 };
			}
			console.error(`[Bazarr] getSystemHistory failed:`, e);
			return { events: [], total: 0 };
		}
	});
}

// ---------------------------------------------------------------------------
// Exported action helpers
// ---------------------------------------------------------------------------

export async function resetProviders(config: ServiceConfig): Promise<void> {
	await bazarrFetch(config, '/api/providers', {
		method: 'POST',
		body: JSON.stringify({ action: 'reset' })
	});
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const bazarrAdapter: ServiceAdapter = {
	id: 'bazarr',
	displayName: 'Bazarr',
	defaultPort: 6767,
	color: '#e0b818',
	abbreviation: 'BZ',
	isEnrichmentOnly: true,

	contractVersion: 1,
	tier: 'server',
	capabilities: {
		enrichmentOnly: true,
		adminAuth: {
			required: true,
			fields: ['url', 'adminApiKey'],
			supportsHealthProbe: true
		}
	},

	async probeAdminCredential(config) {
		try {
			const res = await fetch(`${config.url}/api/system/status?apikey=${encodeURIComponent(config.apiKey ?? '')}`, {
				signal: AbortSignal.timeout(5000)
			});
			if (res.status === 401 || res.status === 403) return 'invalid';
			if (!res.ok) return 'expired';
			return 'ok';
		} catch {
			return 'expired';
		}
	},

	icon: 'bazarr',
	onboarding: {
		category: 'subtitles',
		description: 'Manage subtitles across your library',
		priority: 1,
		requiredFields: ['url', 'apiKey'],
	},

	async ping(config: ServiceConfig): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await bazarrFetch(config, '/api/system/health', { timeoutMs: 5000 });
			return {
				serviceId: config.id,
				name: config.name,
				type: 'bazarr',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'bazarr',
				online: false,
				latency: Date.now() - start,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	},

	async setItemStatus(config: ServiceConfig, sourceId: string, status: Record<string, unknown>): Promise<void> {
		const action = status.action as string;

		if (action === 'download-subtitle') {
			const isMovie = status.mediaType === 'movie';
			const endpoint = isMovie ? '/api/movies/subtitles' : '/api/episodes/subtitles';
			await bazarrFetch(config, endpoint, {
				method: 'PATCH',
				body: JSON.stringify({
					id: Number(sourceId),
					language: status.language,
					hi: status.hi ?? false,
					forced: status.forced ?? false,
					...(status.provider ? { provider: status.provider } : {})
				})
			});
		}

		if (action === 'sync-subtitle') {
			await bazarrFetch(config, '/api/subtitles', {
				method: 'PATCH',
				body: JSON.stringify({
					action: 'sync',
					language: status.language,
					path: status.path,
					id: Number(sourceId),
					mediaType: status.mediaType === 'movie' ? 'radarr' : 'sonarr'
				})
			});
		}

		if (action === 'translate-subtitle') {
			await bazarrFetch(config, '/api/subtitles', {
				method: 'PATCH',
				body: JSON.stringify({
					action: 'translate',
					language: status.language,
					path: status.path,
					id: Number(sourceId),
					mediaType: status.mediaType === 'movie' ? 'radarr' : 'sonarr'
				})
			});
		}

		if (action === 'delete-subtitle') {
			const isMovie = status.mediaType === 'movie';
			const endpoint = isMovie ? '/api/movies/subtitles' : '/api/episodes/subtitles';
			await bazarrFetch(config, endpoint, {
				method: 'DELETE',
				body: JSON.stringify({
					id: Number(sourceId),
					language: status.language,
					path: status.path
				})
			});
		}
	},

	async uploadContent(config: ServiceConfig, parentId: string, type: string, blob: Blob, fileName: string): Promise<void> {
		if (type !== 'subtitle') return;

		// Determine media type from fileName convention: "movie:en" or "episode:en"
		// The parentId encodes the Radarr/Sonarr ID, and the caller should pass
		// mediaType info via the fileName as "movie/{radarrId}/{lang}" or "episode/{sonarrEpisodeId}/{lang}"
		const parts = fileName.split('/');
		const isMovie = parts[0] === 'movie';
		const endpoint = isMovie ? '/api/movies/subtitles' : '/api/episodes/subtitles';
		const language = parts[2] ?? 'en';

		const form = new FormData();
		form.append('file', blob, fileName);
		form.append('id', parentId);
		form.append('language', language);
		form.append('hi', 'false');
		form.append('forced', 'false');

		await bazarrFetch(config, endpoint, {
			method: 'POST',
			body: form
		});
	}
};
