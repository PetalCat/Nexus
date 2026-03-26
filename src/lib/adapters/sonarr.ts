import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult } from './types';

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

export const sonarrAdapter: ServiceAdapter = {
	id: 'sonarr',
	displayName: 'Sonarr',
	defaultPort: 8989,
	icon: 'sonarr',
	mediaTypes: ['show'],

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
			const data = await sonarrFetch(config, '/queue');
			return (data?.records ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
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
	}
};
