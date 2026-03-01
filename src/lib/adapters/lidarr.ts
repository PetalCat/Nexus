import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult } from './types';

async function lidarrFetch(config: ServiceConfig, path: string) {
	const url = new URL(`${config.url}/api/v1${path}`);
	url.searchParams.set('apikey', config.apiKey ?? '');
	const res = await fetch(url.toString());
	if (!res.ok) throw new Error(`Lidarr ${path} → ${res.status}`);
	return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeArtist(config: ServiceConfig, item: any): UnifiedMedia {
	return {
		id: `artist-${item.id}:${config.id}`,
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

export const lidarrAdapter: ServiceAdapter = {
	id: 'lidarr',
	displayName: 'Lidarr',
	defaultPort: 8686,
	icon: 'lidarr',
	mediaTypes: ['music'],

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
	}
};
