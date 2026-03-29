import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth } from './types';
import { withCache } from '../server/cache';

async function prowlarrFetch(config: ServiceConfig, path: string) {
	const url = new URL(`${config.url}/api/v1${path}`);
	url.searchParams.set('apikey', config.apiKey ?? '');
	const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
	if (!res.ok) throw new Error(`Prowlarr ${path} → ${res.status}`);
	return res.json();
}

// ---------------------------------------------------------------------------
// Exported data helpers (admin-only)
// ---------------------------------------------------------------------------

export interface ProwlarrIndexer {
	id: number;
	name: string;
	protocol: string;
	enable: boolean;
	privacy: string;
	fields?: Array<{ name: string; value: unknown }>;
}

export interface ProwlarrIndexerStats {
	indexerId: number;
	indexerName: string;
	averageResponseTime: number;
	numberOfQueries: number;
	numberOfGrabs: number;
	numberOfFailures: number;
	numberOfRssQueries: number;
}

export interface ProwlarrStats {
	indexers: ProwlarrIndexerStats[];
	total: {
		numberOfQueries: number;
		numberOfGrabs: number;
		numberOfFailures: number;
	};
}

export async function getProwlarrIndexers(config: ServiceConfig): Promise<ProwlarrIndexer[]> {
	return withCache(`prowlarr:indexers:${config.id}`, 60_000, async () => {
		return prowlarrFetch(config, '/indexer');
	});
}

export async function getProwlarrStats(config: ServiceConfig): Promise<ProwlarrStats> {
	return withCache(`prowlarr:stats:${config.id}`, 30_000, async () => {
		const data = await prowlarrFetch(config, '/indexerstats');
		const indexers: ProwlarrIndexerStats[] = (data.indexers ?? []).map((i: any) => ({
			indexerId: i.indexerId,
			indexerName: i.indexerName,
			averageResponseTime: i.averageResponseTime ?? 0,
			numberOfQueries: i.numberOfQueries ?? 0,
			numberOfGrabs: i.numberOfGrabs ?? 0,
			numberOfFailures: i.numberOfFailures ?? 0,
			numberOfRssQueries: i.numberOfRssQueries ?? 0
		}));
		return {
			indexers,
			total: {
				numberOfQueries: indexers.reduce((s, i) => s + i.numberOfQueries, 0),
				numberOfGrabs: indexers.reduce((s, i) => s + i.numberOfGrabs, 0),
				numberOfFailures: indexers.reduce((s, i) => s + i.numberOfFailures, 0)
			}
		};
	});
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const prowlarrAdapter: ServiceAdapter = {
	id: 'prowlarr',
	displayName: 'Prowlarr',
	defaultPort: 9696,
	color: '#ef4444',
	abbreviation: 'PW',
	isEnrichmentOnly: true,
	icon: 'prowlarr',
	mediaTypes: ['other'],

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await prowlarrFetch(config, '/system/status');
			return {
				serviceId: config.id,
				name: config.name,
				type: 'prowlarr',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'prowlarr',
				online: false,
				error: String(e)
			};
		}
	}
};
