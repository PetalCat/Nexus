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
