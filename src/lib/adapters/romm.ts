import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult } from './types';

async function rommFetch(config: ServiceConfig, path: string) {
	const url = `${config.url}/api/v3${path}`;
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
	else if (config.username && config.password) {
		headers['Authorization'] =
			'Basic ' + btoa(`${config.username}:${config.password}`);
	}
	const res = await fetch(url, { headers });
	if (!res.ok) throw new Error(`RomM ${path} → ${res.status}`);
	return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(config: ServiceConfig, item: any): UnifiedMedia {
	return {
		id: `${item.id}:${config.id}`,
		sourceId: String(item.id),
		serviceId: config.id,
		serviceType: 'romm',
		type: 'game',
		title: item.name || item.fs_name || 'Unknown',
		sortTitle: item.name,
		description: item.summary,
		poster: item.cover_url || item.url_cover,
		backdrop: item.screenshots?.[0]?.url,
		year: item.first_release_date
			? new Date(item.first_release_date * 1000).getFullYear()
			: undefined,
		rating: item.total_rating,
		genres: item.genres?.map((g: { name: string }) => g.name) ?? [],
		status: 'available',
		metadata: {
			rommId: item.id,
			platform: item.platform_name,
			fileSize: item.file_size_bytes
		},
		actionLabel: 'Play',
		actionUrl: `${config.url}/game/${item.id}`
	};
}

export const rommAdapter: ServiceAdapter = {
	id: 'romm',
	displayName: 'RomM',
	defaultPort: 8080,
	icon: 'romm',
	mediaTypes: ['game'],

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await rommFetch(config, '/heartbeat');
			return {
				serviceId: config.id,
				name: config.name,
				type: 'romm',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'romm',
				online: false,
				error: String(e)
			};
		}
	},

	async getRecentlyAdded(config): Promise<UnifiedMedia[]> {
		try {
			const data = await rommFetch(config, '/roms?order_by=created_at&order_dir=desc&size=20');
			return (data?.items ?? data ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	async search(config, query): Promise<UnifiedSearchResult> {
		try {
			const data = await rommFetch(
				config,
				`/roms?search_term=${encodeURIComponent(query)}&size=20`
			);
			const items = (data?.items ?? data ?? []).map((i: unknown) => normalize(config, i));
			return { items, total: data?.total ?? items.length, source: 'romm' };
		} catch {
			return { items: [], total: 0, source: 'romm' };
		}
	},

	async getItem(config, sourceId): Promise<UnifiedMedia | null> {
		try {
			const item = await rommFetch(config, `/roms/${sourceId}`);
			return normalize(config, item);
		} catch {
			return null;
		}
	}
};
