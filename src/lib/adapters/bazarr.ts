import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth } from './types';
import { withCache } from '../server/cache';

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
	timeoutMs = 8000
): Promise<unknown> {
	const url = `${config.url.replace(/\/+$/, '')}${path}`;
	const res = await fetch(url, {
		headers: {
			'X-API-KEY': config.apiKey ?? '',
			Accept: 'application/json'
		},
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`Bazarr ${path} -> ${res.status}`);
	return res.json();
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
		try {
			const isShow = opts?.type === 'show' || opts?.type === 'episode' || !!opts?.sonarrId;

			// Try TMDB ID first
			if (tmdbId) {
				if (isShow) {
					const data = (await bazarrFetch(config, `/api/series?tmdbid[]=${tmdbId}`)) as { data?: unknown[] };
					const items = data.data ?? (Array.isArray(data) ? data : []);
					if (items.length > 0) return normalizeEpisodeStatus(items[0]);
				} else {
					const data = (await bazarrFetch(config, `/api/movies?tmdbid[]=${tmdbId}`)) as { data?: unknown[] };
					const items = data.data ?? (Array.isArray(data) ? data : []);
					if (items.length > 0) return normalizeMovieStatus(items[0]);
				}
			}

			// Fall back to Radarr/Sonarr ID
			if (opts?.radarrId) {
				const movie = await bazarrFetch(config, `/api/movies/${opts.radarrId}`);
				return normalizeMovieStatus(movie);
			}
			if (opts?.sonarrId) {
				const series = await bazarrFetch(config, `/api/series/${opts.sonarrId}`);
				return normalizeEpisodeStatus(series);
			}

			return null;
		} catch (e) {
			console.error(`[Bazarr] getSubtitleStatus failed:`, e);
			return null;
		}
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
			console.error(`[Bazarr] getItemSubtitleHistory failed:`, e);
			return [];
		}
	});
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const bazarrAdapter: ServiceAdapter = {
	id: 'bazarr',
	displayName: 'Bazarr',
	defaultPort: 6767,
	icon: 'bazarr',

	async ping(config: ServiceConfig): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await bazarrFetch(config, '/api/system/status', 5000);
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
	}
};
