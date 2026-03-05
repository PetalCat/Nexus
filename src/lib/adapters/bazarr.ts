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
