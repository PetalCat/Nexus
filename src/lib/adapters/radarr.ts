import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, CalendarItem, QualityInfo } from './types';

async function radarrFetch(config: ServiceConfig, path: string) {
	const url = new URL(`${config.url}/api/v3${path}`);
	url.searchParams.set('apikey', config.apiKey ?? '');
	const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
	if (!res.ok) throw new Error(`Radarr ${path} → ${res.status}`);
	return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(config: ServiceConfig, item: any): UnifiedMedia {
	const itemId = item.id ?? item.tmdbId ?? item.imdbId ?? crypto.randomUUID();
	return {
		id: `${itemId}:${config.id}`,
		sourceId: String(itemId),
		serviceId: config.id,
		serviceType: 'radarr',
		type: 'movie',
		title: item.title || 'Unknown',
		sortTitle: item.sortTitle,
		description: item.overview,
		poster: item.images?.find((i: { coverType: string }) => i.coverType === 'poster')?.remoteUrl,
		backdrop: item.images?.find((i: { coverType: string }) => i.coverType === 'fanart')?.remoteUrl,
		year: item.year,
		rating: item.ratings?.imdb?.value,
		genres: item.genres ?? [],
		status: item.hasFile ? 'available' : item.isAvailable ? 'missing' : 'missing',
		duration: item.runtime ? item.runtime * 60 : undefined,
		metadata: {
			radarrId: item.id,
			tmdbId: item.tmdbId,
			hasFile: item.hasFile,
			sizeOnDisk: item.sizeOnDisk,
			monitored: item.monitored
		},
		actionLabel: item.hasFile ? 'Watch' : 'Request',
		actionUrl: `${config.url}/movie/${item.titleSlug}`
	};
}

let radarrQualityCache: { profiles: any[]; formats: any[]; ts: number } | null = null;

async function getRadarrQualityMeta(config: ServiceConfig) {
	if (radarrQualityCache && Date.now() - radarrQualityCache.ts < 1_800_000) return radarrQualityCache;
	const [profiles, formats] = await Promise.all([
		radarrFetch(config, '/qualityprofile'),
		radarrFetch(config, '/customformat')
	]);
	radarrQualityCache = { profiles, formats, ts: Date.now() };
	return radarrQualityCache;
}

export const radarrAdapter: ServiceAdapter = {
	id: 'radarr',
	displayName: 'Radarr',
	defaultPort: 7878,
	color: '#fbbf24',
	abbreviation: 'RD',
	isSearchable: true,
	searchPriority: 3,
	icon: 'radarr',
	mediaTypes: ['movie'],

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await radarrFetch(config, '/system/status');
			return {
				serviceId: config.id,
				name: config.name,
				type: 'radarr',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'radarr',
				online: false,
				error: String(e)
			};
		}
	},

	async getRecentlyAdded(config): Promise<UnifiedMedia[]> {
		try {
			const data = await radarrFetch(config, '/movie?sortKey=added&sortDir=desc');
			return (data ?? []).slice(0, 20).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	async getQueue(config): Promise<UnifiedMedia[]> {
		try {
			const data = await radarrFetch(config, '/queue?page=1&pageSize=50&includeUnknownMovieItems=true&includeMovie=true');
			return (data?.records ?? []).map((r: any): UnifiedMedia => {
				const movie = r.movie ?? {};
				const base = normalize(config, movie);
				const status = r.trackedDownloadStatus === 'error' ? 'failed' : r.status === 'completed' ? 'completed' : r.trackedDownloadStatus === 'warning' ? 'warning' : r.trackedDownloadState === 'downloading' ? 'downloading' : r.status === 'paused' ? 'paused' : 'queued';
				return {
					...base,
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
			const data = await radarrFetch(
				config,
				`/movie/lookup?term=${encodeURIComponent(query)}`
			);
			return {
				items: (data ?? []).slice(0, 20).map((i: unknown) => normalize(config, i)),
				total: data?.length ?? 0,
				source: 'radarr'
			};
		} catch {
			return { items: [], total: 0, source: 'radarr' };
		}
	},

	async enrichItem(config, item, enrichmentType) {
		if (enrichmentType !== 'quality') return item;
		try {
			// Try radarrId first, then look up by TMDB ID
			let movie: any = null;
			const radarrId = item.metadata?.radarrId;
			if (radarrId) {
				movie = await radarrFetch(config, `/movie/${radarrId}`);
			} else {
				const tmdbId = item.metadata?.tmdbId ?? item.metadata?.providerIds?.Tmdb;
				if (tmdbId) {
					const movies = await radarrFetch(config, `/movie?tmdbId=${tmdbId}`);
					movie = Array.isArray(movies) ? movies[0] : movies;
				}
			}
			if (!movie) return item;
			if (!movie?.movieFile) return item;

			const { profiles, formats } = await getRadarrQualityMeta(config);
			const profile = profiles.find((p: any) => p.id === movie.qualityProfileId);
			const mediaInfo = movie.movieFile.mediaInfo;
			const appliedFormats = movie.movieFile.customFormats ?? [];
			const formatNames = appliedFormats.map((f: any) => {
				const match = formats.find((cf: any) => cf.id === f.id);
				return match?.name ?? f.name;
			}).filter(Boolean);

			const quality: QualityInfo = {
				resolution: mediaInfo?.resolution,
				hdr: mediaInfo?.videoHdrFormat || undefined,
				audioFormat: mediaInfo?.audioCodec,
				audioChannels: mediaInfo?.audioChannels ? String(mediaInfo.audioChannels) : undefined,
				videoCodec: mediaInfo?.videoCodec,
				customFormats: formatNames.length > 0 ? formatNames : undefined,
				qualityProfile: profile?.name
			};

			return { ...item, metadata: { ...item.metadata, quality } };
		} catch {
			return item;
		}
	},

	async getSubItems(config, parentId, type) {
		if (type === 'collection') {
			if (!parentId) {
				// List all collections
				const data = await radarrFetch(config, '/collection');
				const items = (data ?? []).map((c: any): UnifiedMedia => ({
					id: `collection-${c.id}:${config.id}`,
					sourceId: String(c.tmdbId ?? c.id),
					serviceId: config.id,
					serviceType: 'radarr',
					type: 'movie',
					title: c.title ?? 'Unknown Collection',
					poster: c.images?.find((i: any) => i.coverType === 'poster')?.remoteUrl,
					backdrop: c.images?.find((i: any) => i.coverType === 'fanart')?.remoteUrl,
					metadata: {
						collectionId: c.id,
						tmdbId: c.tmdbId,
						movieCount: c.movies?.length ?? 0,
						missingMovies: c.movies?.filter((m: any) => !m.hasFile).length ?? 0
					}
				}));
				return { items, total: items.length };
			} else {
				// Get single collection detail
				const collections = await radarrFetch(config, '/collection');
				const collection = (collections ?? []).find((c: any) => String(c.tmdbId) === parentId || String(c.id) === parentId);
				if (!collection) return { items: [], total: 0 };
				const movies = (collection.movies ?? []).map((m: any) => normalize(config, m));
				return { items: movies, total: movies.length };
			}
		}
		return { items: [], total: 0 };
	},

	async getCalendar(config, start, end) {
		try {
			const data = await radarrFetch(config, `/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&unmonitored=false`);
			return (data ?? []).map((item: any): CalendarItem => ({
				id: `radarr-cal-${item.id}:${config.id}`,
				sourceId: String(item.tmdbId ?? item.id),
				serviceId: config.id,
				title: item.title ?? 'Unknown',
				mediaType: 'movie',
				releaseDate: item.digitalRelease ?? item.physicalRelease ?? item.inCinemas ?? '',
				poster: item.images?.find((i: any) => i.coverType === 'poster')?.remoteUrl,
				overview: item.overview,
				status: item.hasFile ? 'released' : 'upcoming'
			}));
		} catch { return []; }
	}
};
