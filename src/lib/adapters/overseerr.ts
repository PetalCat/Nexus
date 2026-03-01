import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult } from './types';

async function osFetch(config: ServiceConfig, path: string, opts?: RequestInit) {
	const url = `${config.url}/api/v1${path}`;
	const res = await fetch(url, {
		...opts,
		headers: {
			'X-Api-Key': config.apiKey ?? '',
			'Content-Type': 'application/json',
			...opts?.headers
		}
	});
	if (!res.ok) throw new Error(`Overseerr ${path} → ${res.status}`);
	return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(config: ServiceConfig, item: any): UnifiedMedia {
	const isMovie = item.mediaType === 'movie';
	return {
		id: `${item.id}:${config.id}`,
		sourceId: String(item.id),
		serviceId: config.id,
		serviceType: 'overseerr',
		type: isMovie ? 'movie' : 'show',
		title: item.title || item.name || 'Unknown',
		sortTitle: item.originalTitle || item.originalName,
		description: item.overview,
		poster: item.posterPath ? `https://image.tmdb.org/t/p/w500${item.posterPath}` : undefined,
		backdrop: item.backdropPath
			? `https://image.tmdb.org/t/p/w1280${item.backdropPath}`
			: undefined,
		year: item.releaseDate
			? new Date(item.releaseDate).getFullYear()
			: item.firstAirDate
				? new Date(item.firstAirDate).getFullYear()
				: undefined,
		rating: item.voteAverage,
		genres: item.genres?.map((g: { name: string }) => g.name) ?? [],
		status: mapStatus(item.mediaInfo?.status),
		metadata: {
			tmdbId: item.id,
			mediaInfo: item.mediaInfo,
			requestStatus: item.mediaInfo?.requests?.[0]?.status
		},
		actionLabel: item.mediaInfo?.status === 5 ? (isMovie ? 'Watch' : 'Watch') : 'Request',
		actionUrl: `${config.url}/${isMovie ? 'movie' : 'tv'}/${item.id}`
	};
}

function mapStatus(s?: number): UnifiedMedia['status'] {
	switch (s) {
		case 5:
			return 'available';
		case 3:
		case 4:
			return 'downloading';
		case 2:
			return 'requested';
		default:
			return 'missing';
	}
}

export const overseerrAdapter: ServiceAdapter = {
	id: 'overseerr',
	displayName: 'Overseerr',
	defaultPort: 5055,
	icon: 'overseerr',
	mediaTypes: ['movie', 'show'],

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await osFetch(config, '/status');
			return {
				serviceId: config.id,
				name: config.name,
				type: 'overseerr',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'overseerr',
				online: false,
				error: String(e)
			};
		}
	},

	async getRecentlyAdded(config): Promise<UnifiedMedia[]> {
		try {
			const data = await osFetch(config, '/media?filter=available&sort=added&take=20');
			return (data?.results ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	async getTrending(config): Promise<UnifiedMedia[]> {
		try {
			const [movies, tv] = await Promise.all([
				osFetch(config, '/discover/trending').catch(() => ({ results: [] })),
				osFetch(config, '/discover/trending/tv').catch(() => ({ results: [] }))
			]);
			return [...(movies.results ?? []), ...(tv.results ?? [])].map((i: unknown) =>
				normalize(config, i)
			);
		} catch {
			return [];
		}
	},

	async search(config, query): Promise<UnifiedSearchResult> {
		try {
			const data = await osFetch(
				config,
				`/search?query=${encodeURIComponent(query)}&page=1`
			);
			return {
				items: (data.results ?? []).map((i: unknown) => normalize(config, i)),
				total: data.totalResults ?? 0,
				source: 'overseerr'
			};
		} catch {
			return { items: [], total: 0, source: 'overseerr' };
		}
	},

	async requestMedia(config, tmdbId, type): Promise<boolean> {
		try {
			await osFetch(config, '/request', {
				method: 'POST',
				body: JSON.stringify({ mediaType: type, mediaId: Number(tmdbId) })
			});
			return true;
		} catch {
			return false;
		}
	}
};
