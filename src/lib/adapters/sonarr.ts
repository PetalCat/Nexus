import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, CalendarItem, QualityInfo } from './types';

async function sonarrFetch(config: ServiceConfig, path: string) {
	const url = new URL(`${config.url}/api/v3${path}`);
	url.searchParams.set('apikey', config.apiKey ?? '');
	const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
	if (!res.ok) throw new Error(`Sonarr ${path} → ${res.status}`);
	return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(config: ServiceConfig, item: any): UnifiedMedia {
	return {
		id: `${item.id}:${config.id}`,
		sourceId: String(item.id),
		serviceId: config.id,
		serviceType: 'sonarr',
		type: 'show',
		title: item.title || 'Unknown',
		sortTitle: item.sortTitle,
		description: item.overview,
		poster: item.images?.find((i: { coverType: string }) => i.coverType === 'poster')?.remoteUrl,
		backdrop: item.images?.find((i: { coverType: string }) => i.coverType === 'fanart')?.remoteUrl,
		year: item.year,
		rating: item.ratings?.value,
		genres: item.genres ?? [],
		status: item.statistics?.percentOfEpisodes === 100 ? 'available' : 'continuing',
		metadata: {
			sonarrId: item.id,
			tvdbId: item.tvdbId,
			totalEpisodeCount: item.statistics?.totalEpisodeCount,
			episodeFileCount: item.statistics?.episodeFileCount,
			monitored: item.monitored,
			status: item.status
		},
		actionLabel: 'Watch',
		actionUrl: `${config.url}/series/${item.titleSlug}`
	};
}

/**
 * Look up series via Sonarr's SkyHook proxy. `term` may be free text or a
 * `tmdb:<id>` token — SkyHook resolves tmdb→tvdb and returns the full series
 * resource (including `tvdbId`), which is what Sonarr is keyed on. Returns the
 * raw Sonarr lookup resources.
 */
export async function sonarrLookupSeries(config: ServiceConfig, term: string): Promise<any[]> {
	const data = await sonarrFetch(config, `/series/lookup?term=${encodeURIComponent(term)}`);
	return Array.isArray(data) ? data : [];
}

/** Result of pushing a series into Sonarr. */
export interface SonarrAddResult {
	tvdbId: number;
	arrItemId: number;
	qualityProfileId: number;
	rootFolderPath: string;
	/** True when the series already existed in Sonarr (no new add performed). */
	alreadyPresent: boolean;
}

/**
 * Add a series to Sonarr by TMDB id and trigger a search for missing episodes.
 *
 * CRITICAL: Sonarr is keyed on TVDB id, not TMDB id. We resolve tmdb→tvdb via
 * SkyHook (`/series/lookup?term=tmdb:<id>`), which also returns the full series
 * resource to POST.
 *
 * Steps:
 *   1. lookup by tmdb:<id> → full resource + tvdbId.
 *   2. GET /series — if already present (matched by tvdbId), return its id.
 *   3. GET /qualityprofile + /rootfolder — first of each.
 *   4. Probe /system/status; only send languageProfileId on Sonarr v3 (v4
 *      removed language profiles).
 *   5. POST /series with monitoring + search options.
 */
export async function sonarrRequestMedia(
	config: ServiceConfig,
	opts: { tmdbId: number; title?: string; seasons?: number[] }
): Promise<SonarrAddResult> {
	const { tmdbId } = opts;

	// 1. Resolve tmdb → tvdb + full resource.
	const lookup = await sonarrLookupSeries(config, `tmdb:${tmdbId}`);
	const resource = lookup[0];
	if (!resource) throw new Error(`Sonarr lookup found no series for tmdb:${tmdbId}`);
	const tvdbId: number = resource.tvdbId;
	if (!tvdbId) throw new Error(`Sonarr lookup returned no tvdbId for tmdb:${tmdbId}`);

	// 2. Already present? Sonarr's series list is keyed on tvdbId.
	const allSeries = await sonarrFetch(config, '/series');
	const existing = Array.isArray(allSeries)
		? allSeries.find((s: any) => s.tvdbId === tvdbId)
		: undefined;
	if (existing?.id) {
		return {
			tvdbId,
			arrItemId: existing.id,
			qualityProfileId: existing.qualityProfileId,
			rootFolderPath: existing.rootFolderPath ?? existing.path,
			alreadyPresent: true
		};
	}

	// 3. Defaults: first quality profile + first root folder.
	const [profiles, rootFolders] = await Promise.all([
		sonarrFetch(config, '/qualityprofile'),
		sonarrFetch(config, '/rootfolder')
	]);
	const qualityProfileId: number | undefined = Array.isArray(profiles) ? profiles[0]?.id : undefined;
	const rootFolderPath: string | undefined = Array.isArray(rootFolders) ? rootFolders[0]?.path : undefined;
	if (qualityProfileId == null) throw new Error('Sonarr has no quality profiles configured');
	if (!rootFolderPath) throw new Error('Sonarr has no root folders configured');

	// 4. Version probe — Sonarr v4 removed languageProfileId; only send on v3.
	let isV3 = false;
	try {
		const status = await sonarrFetch(config, '/system/status');
		const version: string = status?.version ?? '';
		isV3 = version.startsWith('3.');
	} catch {
		// If we can't read the version, omit languageProfileId (v4 default).
	}
	let languageProfileId: number | undefined;
	if (isV3) {
		try {
			const langProfiles = await sonarrFetch(config, '/languageprofile');
			languageProfileId = Array.isArray(langProfiles) ? langProfiles[0]?.id : undefined;
		} catch {
			/* leave undefined */
		}
	}

	// 5. POST the series.
	const body: Record<string, unknown> = {
		...resource,
		qualityProfileId,
		rootFolderPath,
		monitored: true,
		seasonFolder: true,
		seriesType: 'standard',
		addOptions: { monitor: 'all', searchForMissingEpisodes: true }
	};
	if (languageProfileId != null) body.languageProfileId = languageProfileId;

	const url = new URL(`${config.url}/api/v3/series`);
	url.searchParams.set('apikey', config.apiKey ?? '');
	const res = await fetch(url.toString(), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(15000)
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`Sonarr add series → ${res.status} ${detail}`);
	}
	const created = await res.json();
	return {
		tvdbId,
		arrItemId: created.id,
		qualityProfileId,
		rootFolderPath,
		alreadyPresent: false
	};
}

let sonarrQualityCache: { profiles: any[]; formats: any[]; ts: number } | null = null;

async function getSonarrQualityMeta(config: ServiceConfig) {
	if (sonarrQualityCache && Date.now() - sonarrQualityCache.ts < 1_800_000) return sonarrQualityCache;
	const [profiles, formats] = await Promise.all([
		sonarrFetch(config, '/qualityprofile'),
		sonarrFetch(config, '/customformat')
	]);
	sonarrQualityCache = { profiles, formats, ts: Date.now() };
	return sonarrQualityCache;
}

export const sonarrAdapter: ServiceAdapter = {
	id: 'sonarr',
	displayName: 'Sonarr',
	defaultPort: 8989,
	color: '#00d4aa',
	abbreviation: 'SN',

	contractVersion: 1,
	tier: 'server',
	capabilities: {
		media: ['show'],
		adminAuth: {
			required: true,
			fields: ['url', 'adminApiKey'],
			supportsHealthProbe: true
		},
		library: true,
		search: { priority: 1 },
		calendar: true,
		requests: true
	},

	async probeAdminCredential(config) {
		try {
			const res = await fetch(`${config.url}/api/v3/system/status?apikey=${encodeURIComponent(config.apiKey ?? '')}`, {
				signal: AbortSignal.timeout(5000)
			});
			if (res.status === 401 || res.status === 403) return 'invalid';
			if (!res.ok) return 'expired';
			return 'ok';
		} catch {
			return 'expired';
		}
	},

	isSearchable: true,
	searchPriority: 3,
	icon: 'sonarr',
	mediaTypes: ['show'],
	onboarding: {
		category: 'automation',
		description: 'Manage and monitor your TV show collection',
		priority: 2,
		requiredFields: ['url', 'apiKey'],
	},

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await sonarrFetch(config, '/system/status');
			return {
				serviceId: config.id,
				name: config.name,
				type: 'sonarr',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'sonarr',
				online: false,
				error: String(e)
			};
		}
	},

	async getRecentlyAdded(config): Promise<UnifiedMedia[]> {
		try {
			const data = await sonarrFetch(config, '/series?sortKey=added&sortDir=desc');
			return (data ?? []).slice(0, 20).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	async getQueue(config): Promise<UnifiedMedia[]> {
		try {
			const data = await sonarrFetch(config, '/queue?page=1&pageSize=50&includeSeries=true&includeEpisode=true');
			return (data?.records ?? []).map((r: any): UnifiedMedia => {
				const series = r.series ?? {};
				const ep = r.episode ?? {};
				const s = String(ep.seasonNumber ?? 0).padStart(2, '0');
				const e = String(ep.episodeNumber ?? 0).padStart(2, '0');
				const base = normalize(config, series);
				const status = r.trackedDownloadStatus === 'error' ? 'failed' : r.status === 'completed' ? 'completed' : r.trackedDownloadStatus === 'warning' ? 'warning' : r.trackedDownloadState === 'downloading' ? 'downloading' : r.status === 'paused' ? 'paused' : 'queued';
				return {
					...base,
					title: `${series.title ?? 'Unknown'} S${s}E${e}`,
					metadata: {
						...base.metadata,
						queueId: r.id,
						queueStatus: status,
						downloadProgress: r.sizeleft != null && r.size ? Math.round(((r.size - r.sizeleft) / r.size) * 100) : 0,
						sizeBytes: r.size,
						remainingBytes: r.sizeleft,
						eta: r.estimatedCompletionTime,
						downloadClient: r.downloadClient,
						indexer: r.indexer,
						quality: r.quality?.quality?.name,
						errorMessage: r.statusMessages?.[0]?.messages?.[0]
					}
				};
			});
		} catch { return []; }
	},

	async search(config, query): Promise<UnifiedSearchResult> {
		try {
			const data = await sonarrFetch(
				config,
				`/series/lookup?term=${encodeURIComponent(query)}`
			);
			return {
				items: (data ?? []).slice(0, 20).map((i: unknown) => normalize(config, i)),
				total: data?.length ?? 0,
				source: 'sonarr'
			};
		} catch {
			return { items: [], total: 0, source: 'sonarr' };
		}
	},

	async enrichItem(config, item, enrichmentType) {
		if (enrichmentType !== 'quality') return item;
		try {
			const sonarrId = item.metadata?.sonarrId;
			if (!sonarrId) return item;
			const series = await sonarrFetch(config, `/series/${sonarrId}`);
			if (!series) return item;

			const { profiles, formats } = await getSonarrQualityMeta(config);
			const profile = profiles.find((p: any) => p.id === series.qualityProfileId);

			const quality: QualityInfo = {
				qualityProfile: profile?.name,
				customFormats: (series.customFormats ?? []).map((f: any) => {
					const match = formats.find((cf: any) => cf.id === f.id);
					return match?.name ?? f.name;
				}).filter(Boolean)
			};

			return { ...item, metadata: { ...item.metadata, quality } };
		} catch {
			return item;
		}
	},

	async getCalendar(config, start, end) {
		try {
			const data = await sonarrFetch(config, `/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&includeSeries=true&includeEpisodeFile=true&unmonitored=false`);
			return (data ?? []).map((ep: any): CalendarItem => {
				const s = String(ep.seasonNumber ?? 0).padStart(2, '0');
				const e = String(ep.episodeNumber ?? 0).padStart(2, '0');
				return {
					id: `sonarr-cal-${ep.id}:${config.id}`,
					sourceId: String(ep.series?.tvdbId ?? ep.seriesId),
					serviceId: config.id,
					title: `${ep.series?.title ?? ''} S${s}E${e}`,
					mediaType: 'show',
					releaseDate: ep.airDateUtc ?? '',
					poster: ep.series?.images?.find((i: any) => i.coverType === 'poster')?.remoteUrl,
					overview: ep.overview ?? ep.title,
					status: ep.hasFile ? 'released' : 'upcoming'
				};
			});
		} catch { return []; }
	}
};
