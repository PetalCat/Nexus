import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, CalendarItem, QualityInfo } from './types';

async function lidarrFetch(config: ServiceConfig, path: string) {
	const url = new URL(`${config.url}/api/v1${path}`);
	url.searchParams.set('apikey', config.apiKey ?? '');
	const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
	if (!res.ok) throw new Error(`Lidarr ${path} → ${res.status}`);
	return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeArtist(config: ServiceConfig, item: any): UnifiedMedia {
	return {
		id: `artist-${item.id ?? item.foreignArtistId}:${config.id}`,
		sourceId: String(item.id),
		serviceId: config.id,
		serviceType: 'lidarr',
		type: 'music',
		title: item.artistName || 'Unknown Artist',
		sortTitle: item.sortName,
		description: item.overview,
		poster: item.images?.find((i: { coverType: string }) => i.coverType === 'poster')?.remoteUrl,
		backdrop: item.images?.find((i: { coverType: string }) => i.coverType === 'banner')?.remoteUrl,
		genres: item.genres ?? [],
		status: 'available',
		metadata: { lidarrId: item.id, monitored: item.monitored, albumCount: item.statistics?.albumCount },
		actionLabel: 'Listen',
		actionUrl: `${config.url}/artist/${item.foreignArtistId}`
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeAlbum(config: ServiceConfig, item: any): UnifiedMedia {
	return {
		id: `album-${item.id}:${config.id}`,
		sourceId: String(item.id),
		serviceId: config.id,
		serviceType: 'lidarr',
		type: 'album',
		title: item.title || 'Unknown Album',
		description: `By ${item.artist?.artistName ?? 'Unknown Artist'}`,
		poster: item.images?.find((i: { coverType: string }) => i.coverType === 'cover')?.remoteUrl,
		year: item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined,
		genres: item.genres ?? [],
		status: item.statistics?.percentOfTracks === 100 ? 'available' : 'missing',
		metadata: { lidarrId: item.id, artistId: item.artistId, trackCount: item.statistics?.totalTrackCount },
		actionLabel: 'Listen',
		actionUrl: `${config.url}/artist/${item.artist?.foreignArtistId}/album/${item.foreignAlbumId}`
	};
}

// ---------------------------------------------------------------------------
// Enrichment helpers (admin API key, no per-user auth)
// ---------------------------------------------------------------------------

export async function getLidarrArtists(config: ServiceConfig): Promise<Array<{
	id: number;
	name: string;
	foreignArtistId: string;
	overview?: string;
	monitored: boolean;
	albumCount: number;
	imageUrl?: string;
}>> {
	try {
		const data = await lidarrFetch(config, '/artist');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (data ?? []).map((a: any) => ({
			id: a.id,
			name: a.artistName,
			foreignArtistId: a.foreignArtistId,
			overview: a.overview,
			monitored: a.monitored ?? false,
			albumCount: a.statistics?.albumCount ?? 0,
			imageUrl: a.images?.find((i: { coverType: string }) => i.coverType === 'poster')?.remoteUrl
		}));
	} catch {
		return [];
	}
}

export async function getLidarrAlbums(config: ServiceConfig, artistId?: number): Promise<Array<{
	id: number;
	title: string;
	artistName: string;
	foreignAlbumId: string;
	monitored: boolean;
	percentAvailable: number;
	trackCount: number;
	missingTracks: number;
	releaseDate?: string;
}>> {
	try {
		const path = artistId ? `/album?artistId=${artistId}` : '/album';
		const data = await lidarrFetch(config, path);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (data ?? []).map((a: any) => ({
			id: a.id,
			title: a.title,
			artistName: a.artist?.artistName ?? '',
			foreignAlbumId: a.foreignAlbumId,
			monitored: a.monitored ?? false,
			percentAvailable: a.statistics?.percentOfTracks ?? 0,
			trackCount: a.statistics?.totalTrackCount ?? 0,
			missingTracks: (a.statistics?.totalTrackCount ?? 0) - (a.statistics?.trackFileCount ?? 0),
			releaseDate: a.releaseDate
		}));
	} catch {
		return [];
	}
}

export async function getLidarrWanted(config: ServiceConfig, opts?: { limit?: number; offset?: number }): Promise<{
	items: Array<{ albumTitle: string; artistName: string; monitored: boolean; releaseDate?: string }>;
	total: number;
}> {
	try {
		const data = await lidarrFetch(config, `/wanted/missing?page=1&pageSize=${opts?.limit ?? 20}&sortKey=releaseDate&sortDirection=descending`);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const items = (data.records ?? []).map((r: any) => ({
			albumTitle: r.title,
			artistName: r.artist?.artistName ?? '',
			monitored: r.monitored ?? false,
			releaseDate: r.releaseDate
		}));
		return { items, total: data.totalRecords ?? 0 };
	} catch {
		return { items: [], total: 0 };
	}
}

export async function getLidarrQueue(config: ServiceConfig): Promise<Array<{
	albumTitle: string;
	artistName: string;
	status: string;
	progress: number;
}>> {
	try {
		const data = await lidarrFetch(config, '/queue');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (data.records ?? []).map((r: any) => ({
			albumTitle: r.album?.title ?? r.title ?? '',
			artistName: r.artist?.artistName ?? '',
			status: r.status ?? 'unknown',
			progress: r.sizeleft && r.size ? Math.round(((r.size - r.sizeleft) / r.size) * 100) : 0
		}));
	} catch {
		return [];
	}
}

let lidarrQualityCache: { profiles: any[]; ts: number } | null = null;

async function getLidarrQualityMeta(config: ServiceConfig) {
	if (lidarrQualityCache && Date.now() - lidarrQualityCache.ts < 1_800_000) return lidarrQualityCache;
	const profiles = await lidarrFetch(config, '/qualityprofile');
	lidarrQualityCache = { profiles, ts: Date.now() };
	return lidarrQualityCache;
}

export const lidarrAdapter: ServiceAdapter = {
	id: 'lidarr',
	displayName: 'Lidarr',
	defaultPort: 8686,
	color: '#1db954',
	abbreviation: 'LI',

	contractVersion: 1,
	tier: 'server',
	capabilities: {
		media: ['music'],
		adminAuth: {
			required: true,
			fields: ['url', 'adminApiKey'],
			supportsHealthProbe: true
		},
		library: true,
		search: { priority: 2 },
		calendar: true,
		requests: true
	},

	async probeAdminCredential(config) {
		try {
			const res = await fetch(`${config.url}/api/v1/system/status?apikey=${encodeURIComponent(config.apiKey ?? '')}`, {
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
	searchPriority: 2,
	icon: 'lidarr',
	mediaTypes: ['music'],
	onboarding: {
		category: 'automation',
		description: 'Manage and monitor your music collection',
		priority: 3,
		requiredFields: ['url', 'apiKey'],
	},

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await lidarrFetch(config, '/system/status');
			return {
				serviceId: config.id,
				name: config.name,
				type: 'lidarr',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'lidarr',
				online: false,
				error: String(e)
			};
		}
	},

	async getRecentlyAdded(config): Promise<UnifiedMedia[]> {
		try {
			const data = await lidarrFetch(config, '/album?includeAllArtistAlbums=false');
			return (data ?? [])
				.sort((a: { releaseDate: string }, b: { releaseDate: string }) =>
					b.releaseDate > a.releaseDate ? 1 : -1
				)
				.slice(0, 20)
				.map((i: unknown) => normalizeAlbum(config, i));
		} catch {
			return [];
		}
	},

	async getQueue(config): Promise<UnifiedMedia[]> {
		try {
			const data = await lidarrFetch(config, '/queue?page=1&pageSize=50&includeAlbum=true&includeArtist=true');
			return (data?.records ?? []).map((r: any): UnifiedMedia => {
				const album = r.album ?? {};
				const artist = r.artist ?? album.artist ?? {};
				const base = normalizeAlbum(config, { ...album, artist });
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
			const data = await lidarrFetch(
				config,
				`/artist/lookup?term=${encodeURIComponent(query)}`
			);
			return {
				items: (data ?? []).slice(0, 20).map((i: unknown) => normalizeArtist(config, i)),
				total: data?.length ?? 0,
				source: 'lidarr'
			};
		} catch {
			return { items: [], total: 0, source: 'lidarr' };
		}
	},

	async enrichItem(config, item, enrichmentType) {
		if (enrichmentType !== 'quality') return item;
		try {
			const lidarrId = item.metadata?.lidarrId;
			if (!lidarrId) return item;
			const album = await lidarrFetch(config, `/album/${lidarrId}`);
			if (!album) return item;

			const { profiles } = await getLidarrQualityMeta(config);
			const profile = profiles.find((p: any) => p.id === album.qualityProfileId);

			const quality: QualityInfo = {
				audioFormat: album.statistics?.trackFileCount > 0 ? 'FLAC' : undefined,
				qualityProfile: profile?.name
			};

			return { ...item, metadata: { ...item.metadata, quality } };
		} catch {
			return item;
		}
	},

	async getCalendar(config, start, end) {
		try {
			const data = await lidarrFetch(config, `/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&unmonitored=false`);
			return (data ?? []).map((album: any): CalendarItem => ({
				id: `lidarr-cal-${album.id}:${config.id}`,
				sourceId: String(album.foreignAlbumId ?? album.id),
				serviceId: config.id,
				title: album.artist?.artistName ? `${album.artist.artistName} — ${album.title}` : album.title ?? 'Unknown',
				mediaType: 'music',
				releaseDate: album.releaseDate ?? '',
				poster: album.images?.find((i: any) => i.coverType === 'cover')?.remoteUrl,
				overview: album.overview,
				status: album.statistics?.percentOfTracks === 100 ? 'released' : 'upcoming'
			}));
		} catch { return []; }
	}
};
