import { eq } from 'drizzle-orm';
import { registry } from '../adapters/registry';
import type { DashboardRow, ServiceConfig, ServiceHealth, UnifiedMedia, UserCredential } from '../adapters/types';
import { getStreamyStatsRecommendations } from '../adapters/streamystats';
import { importJellyfinUser } from '../adapters/overseerr';
import { getDb, schema } from '../db';
import { getUserCredentialForService, upsertUserCredential } from './auth';
import { withCache } from './cache';

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
// Provisioning — create accounts on user-linkable services for a Nexus user
// ---------------------------------------------------------------------------

export interface ProvisionResult {
	serviceId: string;
	serviceName: string;
	serviceType: string;
	status: 'created' | 'linked' | 'skipped' | 'error';
	externalUsername?: string;
	error?: string;
}

/**
 * Provision a Nexus user across all enabled user-linkable services.
 * For each service that supports `createUser`, a new account is created
 * and the credential is stored so the user gets personalized data immediately.
 */
export async function provisionUserOnServices(
	userId: string,
	username: string,
	password: string
): Promise<ProvisionResult[]> {
	const configs = getEnabledConfigs();
	const results: ProvisionResult[] = [];

	for (const config of configs) {
		const adapter = registry.get(config.type);
		if (!adapter?.userLinkable) continue;

		// Check if user already has a credential for this service
		const existing = getUserCredentialForService(userId, config.id);
		if (existing) {
			results.push({
				serviceId: config.id, serviceName: config.name, serviceType: config.type,
				status: 'linked', externalUsername: existing.externalUsername
			});
			continue;
		}

		if (!adapter.createUser) {
			results.push({
				serviceId: config.id, serviceName: config.name, serviceType: config.type,
				status: 'skipped', error: 'Adapter does not support user creation'
			});
			continue;
		}

		try {
			const result = await adapter.createUser(config, username, password);
			upsertUserCredential(userId, config.id, {
				accessToken: result.accessToken,
				externalUserId: result.externalUserId,
				externalUsername: result.externalUsername
			});
			results.push({
				serviceId: config.id, serviceName: config.name, serviceType: config.type,
				status: 'created', externalUsername: result.externalUsername
			});
		} catch (e) {
			console.error(`[Provision] Failed to create user on ${config.name}:`, e);
			results.push({
				serviceId: config.id, serviceName: config.name, serviceType: config.type,
				status: 'error', error: String(e)
			});
		}
	}

	return results;
}

/**
 * Get all user-linkable services that are currently enabled.
 * Used by the UI to show which services users can link to or be provisioned on.
 */
export function getUserLinkableServices() {
	return getEnabledConfigs().filter((c) => {
		const adapter = registry.get(c.type);
		return adapter?.userLinkable;
	}).map((c) => ({
		id: c.id,
		name: c.name,
		type: c.type,
		supportsCreate: !!registry.get(c.type)?.createUser
	}));
}

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the user credential for a service, if the service supports per-user auth.
 * Returns undefined for server-only services (Radarr, Sonarr, etc.).
 *
 * Special case: StreamyStats authenticates via Jellyfin user tokens (not its own),
 * so we look up the user's Jellyfin credential instead.
 */
function resolveUserCred(config: ServiceConfig, userId?: string): UserCredential | undefined {
	if (!userId) return undefined;
	// StreamyStats has no user accounts — it authenticates via the user's Jellyfin token.
	// Handle before the userLinkable gate since streamystats.userLinkable is intentionally false.
	if (config.type === 'streamystats') {
		const jellyfinConfig = getEnabledConfigs().find((c) => c.type === 'jellyfin');
		if (!jellyfinConfig) return undefined;
		return getUserCredentialForService(userId, jellyfinConfig.id) ?? undefined;
	}
	const adapter = registry.get(config.type);
	if (!adapter?.userLinkable) return undefined;
	return getUserCredentialForService(userId, config.id) ?? undefined;
}

// ---------------------------------------------------------------------------
// Dashboard aggregation
// ---------------------------------------------------------------------------

/** Media-server adapter types (things the user actually owns). */
const LIBRARY_TYPES = new Set(['jellyfin', 'calibre', 'romm', 'invidious']);

export async function getDashboard(userId?: string): Promise<DashboardRow[]> {
	const configs = getEnabledConfigs();
	const libraryConfigs = configs.filter((c) => LIBRARY_TYPES.has(c.type));

	// Continue-watching is user-specific (short TTL). Shared rows cached longer.
	const [continueWatching, personalizedRows, newInLibrary] = await Promise.all([
		userId
			? withCache(`cw:${userId}`, 30_000, () => aggregateContinueWatching(configs, userId))
			: Promise.resolve([]),
		userId ? getPersonalizedRows(userId) : Promise.resolve([]),
		// Small "New in Library" row — only from media servers the user actually owns content on
		withCache('new-in-library', 60_000, () => aggregateRecentlyAdded(libraryConfigs, userId))
	]);

	const rows: DashboardRow[] = [];

	if (continueWatching.length > 0) {
		rows.push({ id: 'continue', title: 'Continue Watching', items: continueWatching });
	}
	rows.push(...personalizedRows);
	if (newInLibrary.length > 0) {
		rows.push({
			id: 'new-in-library',
			title: 'New in Your Library',
			subtitle: 'Recently added across your media servers',
			items: newInLibrary.slice(0, 12)
		});
	}

	return rows;
}

async function getPersonalizedRows(userId: string): Promise<DashboardRow[]> {
	const ssConfigs = getEnabledConfigs().filter((c) => c.type === 'streamystats');
	if (ssConfigs.length === 0) return [];

	// StreamyStats authenticates via Jellyfin tokens
	const jellyfinConfig = getEnabledConfigs().find((c) => c.type === 'jellyfin');
	if (!jellyfinConfig) return [];
	const userCred = getUserCredentialForService(userId, jellyfinConfig.id) ?? undefined;
	if (!userCred?.accessToken) return [];

	const rows: DashboardRow[] = [];

	for (const config of ssConfigs) {
		const [movies, shows] = await Promise.allSettled([
			withCache(`ss-recs-Movie:${userId}:${config.id}`, 300_000, () =>
				getStreamyStatsRecommendations(config, 'Movie', userCred, 24)
			),
			withCache(`ss-recs-Series:${userId}:${config.id}`, 300_000, () =>
				getStreamyStatsRecommendations(config, 'Series', userCred, 24)
			)
		]);

		const movieItems = movies.status === 'fulfilled' ? movies.value : [];
		const showItems = shows.status === 'fulfilled' ? shows.value : [];

		if (movieItems.length > 0) {
			rows.push({
				id: `for-you-movies:${config.id}`,
				title: 'For You — Movies',
				subtitle: 'Personalized picks based on your watch history',
				items: movieItems
			});
		}
		if (showItems.length > 0) {
			rows.push({
				id: `for-you-shows:${config.id}`,
				title: 'For You — Shows',
				subtitle: 'Personalized picks based on your watch history',
				items: showItems
			});
		}
	}

	return rows;
}

async function aggregateContinueWatching(configs: ServiceConfig[], userId?: string): Promise<UnifiedMedia[]> {
	const results = await Promise.allSettled(
		configs.map(async (config) => {
			const adapter = registry.get(config.type);
			const cred = resolveUserCred(config, userId);
			return adapter?.getContinueWatching?.(config, cred) ?? [];
		})
	);
	return results
		.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
		.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
}

async function aggregateRecentlyAdded(configs: ServiceConfig[], userId?: string): Promise<UnifiedMedia[]> {
	const results = await Promise.allSettled(
		configs.map(async (config) => {
			const adapter = registry.get(config.type);
			const cred = resolveUserCred(config, userId);
			return adapter?.getRecentlyAdded?.(config, cred) ?? [];
		})
	);
	return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

// ---------------------------------------------------------------------------
// Library browsing
// ---------------------------------------------------------------------------

export async function getLibraryItems(opts?: {
	type?: string;
	limit?: number;
	offset?: number;
	sortBy?: string;
	platformId?: number;
}, userId?: string): Promise<{ items: UnifiedMedia[]; total: number }> {
	// Library only shows content from actual media servers — not discovery or automation services
	let configs = getEnabledConfigs().filter((c) => LIBRARY_TYPES.has(c.type));
	// When filtering by media type, only query adapters that provide that type
	if (opts?.type) {
		configs = configs.filter((c) => {
			const adapter = registry.get(c.type);
			return adapter?.mediaTypes?.includes(opts.type as any);
		});
	}
	const cacheKey = `library:${opts?.type ?? 'all'}:${opts?.offset ?? 0}:${opts?.limit ?? 50}:${opts?.sortBy ?? 'default'}:${opts?.platformId ?? ''}`;
	return withCache(cacheKey, 60_000, async () => {
	const results = await Promise.allSettled(
		configs.map(async (config) => {
			const adapter = registry.get(config.type);
			const cred = resolveUserCred(config, userId);
			if (adapter?.getLibrary) {
				return adapter.getLibrary(config, opts, cred);
			}
			// Fallback: getRecentlyAdded for adapters without getLibrary
			const items = (await adapter?.getRecentlyAdded?.(config, cred)) ?? [];
			return { items, total: items.length };
		})
	);
	const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.items : []));
	const total = results.reduce(
		(sum, r) => sum + (r.status === 'fulfilled' ? r.value.total : 0),
		0
	);
	return { items: all, total };
	}); // end withCache
}

export async function getAllLiveChannels(userId?: string): Promise<UnifiedMedia[]> {
	return withCache(`live-channels:${userId ?? 'anon'}`, 60_000, async () => {
		const configs = getEnabledConfigs();
		const results = await Promise.allSettled(
			configs.map(async (config) => {
				const adapter = registry.get(config.type);
				const cred = resolveUserCred(config, userId);
				return adapter?.getLiveChannels?.(config, cred) ?? [];
			})
		);
		return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
	});
}

export async function getQueue(): Promise<UnifiedMedia[]> {
	return withCache('queue', 15_000, async () => {
		const configs = getEnabledConfigs();
		const results = await Promise.allSettled(
			configs.map(async (config) => {
				const adapter = registry.get(config.type);
				return adapter?.getQueue?.(config) ?? [];
			})
		);
		return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
	});
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function unifiedSearch(query: string, userId?: string): Promise<UnifiedMedia[]> {
	const configs = getEnabledConfigs();
	const results = await Promise.allSettled(
		configs.map(async (config) => {
			const adapter = registry.get(config.type);
			const cred = resolveUserCred(config, userId);
			const result = await adapter?.search?.(config, query, cred);
			return result?.items ?? [];
		})
	);
	return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

// ---------------------------------------------------------------------------
// Jellyfin User Migration
// ---------------------------------------------------------------------------

export async function getJellyfinUsers() {
	const configs = getEnabledConfigs().filter((c) => c.type === 'jellyfin');
	const allUsers: Array<{ serviceId: string; serviceName: string; externalId: string; username: string; isAdmin: boolean }> = [];
	for (const config of configs) {
		const adapter = registry.get('jellyfin');
		if (!adapter?.getUsers) continue;
		const users = await adapter.getUsers(config);
		for (const u of users) {
			allUsers.push({
				serviceId: config.id,
				serviceName: config.name,
				externalId: u.externalId,
				username: u.username,
				isAdmin: u.isAdmin ?? false
			});
		}
	}
	return allUsers;
}

// ---------------------------------------------------------------------------
// Overseerr Auto-Link via Jellyfin credentials
// ---------------------------------------------------------------------------

/**
 * Fast synchronous check: does this user need auto-linking?
 * Returns true if there is an Overseerr (Jellyfin mode) service
 * that does not yet have a stored credential for the user.
 */
export function needsAutoLink(userId: string): boolean {
	const services = getServiceConfigs();
	const jellyfinService = services.find((s) => s.type === 'jellyfin' && s.enabled);
	if (!jellyfinService) return false;
	const jellyfinCred = getUserCredentialForService(userId, jellyfinService.id);
	if (!jellyfinCred?.externalUserId) return false;
	return services.some(
		(s) =>
			s.type === 'overseerr' &&
			s.enabled &&
			!!s.username &&
			!getUserCredentialForService(userId, s.id)?.externalUserId
	);
}

/**
 * Silently link Overseerr (Jellyfin auth mode) using the user's Jellyfin credential.
 * Safe to call without await — all errors are swallowed.
 */
export async function autoLinkJellyfinServices(userId: string): Promise<void> {
	const services = getServiceConfigs();
	const jellyfinService = services.find((s) => s.type === 'jellyfin' && s.enabled);
	if (!jellyfinService) return;
	const jellyfinCred = getUserCredentialForService(userId, jellyfinService.id);
	if (!jellyfinCred?.externalUserId) return;

	const overseerrServices = services.filter(
		(s) => s.type === 'overseerr' && s.enabled && !!s.username
	);

	await Promise.allSettled(
		overseerrServices.map(async (svc) => {
			const existing = getUserCredentialForService(userId, svc.id);
			if (existing?.externalUserId) return; // already linked

			const adapter = registry.get('overseerr');
			if (!adapter?.getUsers) return;

			try {
				let users = await adapter.getUsers(svc);
				let match = users.find((u) => u.jellyfinUserId === jellyfinCred.externalUserId);

				if (!match) {
					const imported = await importJellyfinUser(svc, jellyfinCred.externalUserId!);
					if (imported) {
						users = await adapter.getUsers(svc);
						match = users.find((u) => u.jellyfinUserId === jellyfinCred.externalUserId);
					}
				}

				if (match) {
					upsertUserCredential(userId, svc.id, {
						accessToken: '',
						externalUserId: match.externalId,
						externalUsername: match.username
					});
				}
			} catch (e) {
				console.warn('[Auto-link] Overseerr auto-link failed:', e instanceof Error ? e.message : e);
			}
		})
	);
}

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------

const PING_TIMEOUT_MS = 5000;

export async function checkAllServices(): Promise<ServiceHealth[]> {
	return withCache('health', 30_000, () => checkAllServicesUncached());
}

async function checkAllServicesUncached(): Promise<ServiceHealth[]> {
	const configs = getServiceConfigs();
	return Promise.all(
		configs.map((config) => {
			const adapter = registry.get(config.type);
			if (!adapter) {
				return Promise.resolve({
					serviceId: config.id,
					name: config.name,
					type: config.type,
					online: false,
					error: 'No adapter registered'
				});
			}
			const ping = adapter.ping(config).catch((e): ServiceHealth => ({
				serviceId: config.id,
				name: config.name,
				type: config.type,
				online: false,
				error: String(e)
			}));
			const timeout = new Promise<ServiceHealth>((resolve) =>
				setTimeout(
					() =>
						resolve({
							serviceId: config.id,
							name: config.name,
							type: config.type,
							online: false,
							error: 'Connection timed out'
						}),
					PING_TIMEOUT_MS
				)
			);
			return Promise.race([ping, timeout]);
		})
	);
}
