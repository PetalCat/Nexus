import { eq } from 'drizzle-orm';
import { registry } from '../adapters/registry';
import type { DashboardRow, ServiceConfig, ServiceHealth, UnifiedMedia } from '../adapters/types';
import { getDb, schema } from '../db';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export function getServiceConfigs(): ServiceConfig[] {
	const db = getDb();
	return db.select().from(schema.services).all() as ServiceConfig[];
}

export function getEnabledConfigs(): ServiceConfig[] {
	return getServiceConfigs().filter((s) => s.enabled);
}

export function getServiceConfig(id: string): ServiceConfig | undefined {
	const db = getDb();
	return db
		.select()
		.from(schema.services)
		.where(eq(schema.services.id, id))
		.get() as ServiceConfig | undefined;
}

export function upsertService(config: ServiceConfig) {
	const db = getDb();
	db.insert(schema.services)
		.values({
			...config,
			updatedAt: new Date().toISOString()
		})
		.onConflictDoUpdate({
			target: schema.services.id,
			set: {
				name: config.name,
				url: config.url,
				apiKey: config.apiKey,
				username: config.username,
				password: config.password,
				enabled: config.enabled,
				updatedAt: new Date().toISOString()
			}
		})
		.run();
}

export function deleteService(id: string) {
	const db = getDb();
	db.delete(schema.services).where(eq(schema.services.id, id)).run();
}

// ---------------------------------------------------------------------------
// Dashboard aggregation
// ---------------------------------------------------------------------------

export async function getDashboard(): Promise<DashboardRow[]> {
	const configs = getEnabledConfigs();

	const [continueWatching, recentlyAdded, trending] = await Promise.all([
		aggregateContinueWatching(configs),
		aggregateRecentlyAdded(configs),
		aggregateTrending(configs)
	]);

	const rows: DashboardRow[] = [];

	if (continueWatching.length > 0) {
		rows.push({ id: 'continue', title: 'Continue Watching', items: continueWatching });
	}
	if (recentlyAdded.length > 0) {
		rows.push({ id: 'recently-added', title: 'Recently Added', items: recentlyAdded });
	}
	if (trending.length > 0) {
		rows.push({ id: 'trending', title: 'Trending', items: trending });
	}

	return rows;
}

async function aggregateContinueWatching(configs: ServiceConfig[]): Promise<UnifiedMedia[]> {
	const results = await Promise.allSettled(
		configs.map(async (config) => {
			const adapter = registry.get(config.type);
			return adapter?.getContinueWatching?.(config) ?? [];
		})
	);
	return results
		.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
		.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
}

async function aggregateRecentlyAdded(configs: ServiceConfig[]): Promise<UnifiedMedia[]> {
	const results = await Promise.allSettled(
		configs.map(async (config) => {
			const adapter = registry.get(config.type);
			return adapter?.getRecentlyAdded?.(config) ?? [];
		})
	);
	return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

async function aggregateTrending(configs: ServiceConfig[]): Promise<UnifiedMedia[]> {
	const results = await Promise.allSettled(
		configs.map(async (config) => {
			const adapter = registry.get(config.type);
			return adapter?.getTrending?.(config) ?? [];
		})
	);
	return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function unifiedSearch(query: string): Promise<UnifiedMedia[]> {
	const configs = getEnabledConfigs();
	const results = await Promise.allSettled(
		configs.map(async (config) => {
			const adapter = registry.get(config.type);
			const result = await adapter?.search?.(config, query);
			return result?.items ?? [];
		})
	);
	return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------

export async function checkAllServices(): Promise<ServiceHealth[]> {
	const configs = getServiceConfigs();
	return Promise.all(
		configs.map(async (config) => {
			const adapter = registry.get(config.type);
			if (!adapter) {
				return {
					serviceId: config.id,
					name: config.name,
					type: config.type,
					online: false,
					error: 'No adapter registered'
				};
			}
			return adapter.ping(config);
		})
	);
}
