import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, CalendarItem } from './types';

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
			const data = await radarrFetch(config, '/queue');
			return (data?.records ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
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
