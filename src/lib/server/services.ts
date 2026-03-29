import { randomBytes } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { registry } from '../adapters/registry';
import type { DashboardRow, ServiceConfig, ServiceHealth, UnifiedMedia, UserCredential } from '../adapters/types';
import { getStreamyStatsRecommendations } from '../adapters/streamystats';
import { importJellyfinUser } from '../adapters/overseerr';
import { getDb, getRawDb, schema } from '../db';
import { getAllUsers, getUserCredentialForService, upsertUserCredential } from './auth';
import { withCache, withStaleCache, invalidate } from './cache';

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

/** Get enabled configs for adapters matching a media type */
export function getConfigsForMediaType(mediaType: string): ServiceConfig[] {
	return getEnabledConfigs().filter((c) => {
		const adapter = registry.get(c.type);
		return adapter?.mediaTypes?.includes(mediaType as any);
	});
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
			updatedAt: Date.now()
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
				updatedAt: Date.now()
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

		// Try to link existing account before creating new one
		if (adapter.getUsers && adapter.resetPassword && adapter.authenticateUser) {
			try {
				const existingUsers = await adapter.getUsers(config);
				const match = existingUsers.find(u => u.username.toLowerCase() === username.toLowerCase());
				if (match) {
					const tempPw = randomBytes(24).toString('base64url');
					await adapter.resetPassword(config, match.externalId, tempPw);
					const authResult = await adapter.authenticateUser(config, match.username, tempPw);
					upsertUserCredential(userId, config.id, {
						accessToken: authResult.accessToken,
						externalUserId: authResult.externalUserId,
						externalUsername: authResult.externalUsername
					});
					results.push({
						serviceId: config.id, serviceName: config.name, serviceType: config.type,
						status: 'linked', externalUsername: authResult.externalUsername
					});
					continue;
				}
			} catch (e) {
				console.warn(`[Provision] Auto-link attempt failed for ${config.name}, falling through to createUser:`, e);
				// Fall through to createUser below
			}
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
export function resolveUserCred(config: ServiceConfig, userId?: string): UserCredential | undefined {
	if (!userId) return undefined;
	// Some adapters authenticate via another service (e.g. StreamyStats uses Jellyfin tokens).
	// Handle before the userLinkable gate since these adapters may not be userLinkable themselves.
	const adapter = registry.get(config.type);
	if (adapter?.authVia) {
		const authConfig = getEnabledConfigs().find((c) => c.type === adapter.authVia);
		if (!authConfig) return undefined;
		return getUserCredentialForService(userId, authConfig.id) ?? undefined;
	}
	if (!adapter?.userLinkable) return undefined;
	return getUserCredentialForService(userId, config.id) ?? undefined;
}

// ---------------------------------------------------------------------------
// Dashboard aggregation
// ---------------------------------------------------------------------------

/** Media-server adapter types (things the user actually owns). */
const LIBRARY_TYPES = new Set(registry.libraries().map((a) => a.id));

/** Fast dashboard rows: continue watching + new in library (local Jellyfin calls) */
export async function getDashboardFast(userId?: string): Promise<DashboardRow[]> {
	const configs = getEnabledConfigs();
	const libraryConfigs = configs.filter((c) => LIBRARY_TYPES.has(c.type));

	const [continueWatching, newInLibrary] = await Promise.all([
		userId
			? withStaleCache(`cw:${userId}`, 30_000, 5 * 60_000, () => aggregateContinueWatching(configs, userId))
			: Promise.resolve([]),
		withStaleCache('new-in-library', 60_000, 10 * 60_000, () => aggregateRecentlyAdded(libraryConfigs, userId))
	]);

	const rows: DashboardRow[] = [];
	if (continueWatching.length > 0) {
		rows.push({ id: 'continue', title: 'Continue Watching', items: continueWatching });
	}
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

/** Slow dashboard rows: recommendation engine (content-based + StreamyStats + more) */
export async function getDashboardPersonalized(userId?: string): Promise<DashboardRow[]> {
	if (!userId) return [];
	try {
		const { getRecommendationRows } = await import('./recommendations/aggregator');
		const rows = await getRecommendationRows(userId);
		if (rows.length > 0) return rows;
	} catch (e) {
		console.warn('[services] Recommendation engine unavailable, falling back to StreamyStats:', e instanceof Error ? e.message : e);
	}
	// Fallback to legacy StreamyStats-only path
	return getPersonalizedRows(userId);
}

/** Legacy combined call — still used by anything that wants all rows at once */
export async function getDashboard(userId?: string): Promise<DashboardRow[]> {
	const [fast, personalized] = await Promise.all([
		getDashboardFast(userId),
		getDashboardPersonalized(userId)
	]);
	// Interleave: continue watching first, then personalized, then new in library
	const continueRow = fast.find((r) => r.id === 'continue');
	const newRow = fast.find((r) => r.id === 'new-in-library');
	const rows: DashboardRow[] = [];
	if (continueRow) rows.push(continueRow);
	rows.push(...personalized);
	if (newRow) rows.push(newRow);
	return rows;
}

async function getPersonalizedRows(userId: string): Promise<DashboardRow[]> {
	const ssConfigs = getEnabledConfigs().filter((c) => c.type === 'streamystats');
	if (ssConfigs.length === 0) return [];

	// StreamyStats authenticates via another adapter (e.g. Jellyfin) — resolve via authVia
	const ssAdapter = registry.get('streamystats');
	const authAdapterId = ssAdapter?.authVia;
	const authConfig = authAdapterId ? getEnabledConfigs().find((c) => c.type === authAdapterId) : undefined;
	if (!authConfig) return [];
	const userCred = getUserCredentialForService(userId, authConfig.id) ?? undefined;
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
	const items = results
		.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
		.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));

	if (!userId || items.length > 0) return items;

	// Fallback for cases where upstream resume APIs lag: build from local watch activity.
	const db = getDb();
	const recent = db
		.select({
			mediaId: schema.activity.mediaId,
			serviceId: schema.activity.serviceId,
			progress: schema.activity.progress
		})
		.from(schema.activity)
		.where(
			and(
				eq(schema.activity.userId, userId),
				eq(schema.activity.type, 'watch'),
				eq(schema.activity.completed, false)
			)
		)
		.orderBy(desc(schema.activity.lastActivity))
		.limit(25)
		.all();

	if (recent.length === 0) return items;

	const seen = new Set<string>();
	const fallbackItems = await Promise.allSettled(
		recent.map(async (row) => {
			const config = configs.find((c) => c.id === row.serviceId && LIBRARY_TYPES.has(c.type));
			if (!config) return null;
			const key = `${row.serviceId}:${row.mediaId}`;
			if (seen.has(key)) return null;
			seen.add(key);
			const adapter = registry.get(config.type);
			if (!adapter?.getItem) return null;
			const cred = resolveUserCred(config, userId);
			const item = await adapter.getItem(config, row.mediaId, cred);
			if (!item) return null;
			item.progress = Math.max(item.progress ?? 0, row.progress ?? 0);
			return item;
		})
	);

	return fallbackItems
		.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []))
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

function getCachedLibraryItemsFromDb(opts?: {
	type?: string;
	limit?: number;
	offset?: number;
	sortBy?: string;
}): { items: UnifiedMedia[]; total: number } | null {
	if (!opts?.type || !['movie', 'show'].includes(opts.type)) return null;

	const libraryServiceIds = getEnabledConfigs()
		.filter((c) => LIBRARY_TYPES.has(c.type))
		.map((c) => c.id);

	if (libraryServiceIds.length === 0) return null;

	const raw = getRawDb();
	const placeholders = libraryServiceIds.map(() => '?').join(', ');
	const sortBy = opts.sortBy ?? 'title';
	const orderBy = sortBy === 'year'
		? 'year DESC, sort_title COLLATE NOCASE ASC, title COLLATE NOCASE ASC'
		: sortBy === 'rating'
			? 'rating DESC, sort_title COLLATE NOCASE ASC, title COLLATE NOCASE ASC'
			: sortBy === 'added'
				? 'cached_at DESC, title COLLATE NOCASE ASC'
				: 'sort_title COLLATE NOCASE ASC, title COLLATE NOCASE ASC';

	const totalRow = raw.prepare(
		`SELECT COUNT(*) as count
		 FROM media_items
		 WHERE type = ?
		   AND service_id IN (${placeholders})`
	).get(opts.type, ...libraryServiceIds) as { count: number } | undefined;

	const rows = raw.prepare(
		`SELECT source_id as sourceId, service_id as serviceId, service_type as serviceType, type, title, sort_title as sortTitle,
		        description, poster, backdrop, year, rating, genres, studios, duration, status
		 FROM media_items
		 WHERE type = ?
		   AND service_id IN (${placeholders})
		 ORDER BY ${orderBy}
		 LIMIT ? OFFSET ?`
	).all(
		opts.type,
		...libraryServiceIds,
		opts.limit ?? 50,
		opts.offset ?? 0
	) as Array<{
		sourceId: string;
		serviceId: string;
		serviceType: string;
		type: string;
		title: string;
		sortTitle: string | null;
		description: string | null;
		poster: string | null;
		backdrop: string | null;
		year: number | null;
		rating: number | null;
		genres: string | null;
		studios: string | null;
		duration: number | null;
		status: string | null;
	}>;

	if ((totalRow?.count ?? 0) === 0) return null;

	return {
		items: rows.map((row) => ({
			id: `${row.sourceId}:${row.serviceId}`,
			sourceId: row.sourceId,
			serviceId: row.serviceId,
			serviceType: row.serviceType,
			type: row.type as UnifiedMedia['type'],
			title: row.title,
			sortTitle: row.sortTitle ?? undefined,
			description: row.description ?? undefined,
			poster: row.poster ?? undefined,
			backdrop: row.backdrop ?? undefined,
			year: row.year ?? undefined,
			rating: row.rating ?? undefined,
			genres: row.genres ? JSON.parse(row.genres) as string[] : [],
			studios: row.studios ? JSON.parse(row.studios) as string[] : [],
			duration: row.duration ?? undefined,
			status: (row.status ?? 'available') as UnifiedMedia['status']
		})),
		total: totalRow?.count ?? 0
	};
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
	const dbCached = getCachedLibraryItemsFromDb(opts);
	if (dbCached) return dbCached;

	// Library only shows content from actual media servers — not discovery or automation services
	let configs = getEnabledConfigs().filter((c) => LIBRARY_TYPES.has(c.type));
	// When filtering by media type, only query adapters that provide that type
	if (opts?.type) {
		configs = configs.filter((c) => {
			const adapter = registry.get(c.type);
			return adapter?.mediaTypes?.includes(opts.type as any);
		});
	}
	const cacheKey = `library:${userId ?? 'anon'}:${opts?.type ?? 'all'}:${opts?.offset ?? 0}:${opts?.limit ?? 50}:${opts?.sortBy ?? 'default'}:${opts?.platformId ?? ''}`;
	return withStaleCache(cacheKey, 300_000, 30 * 60_000, async () => {
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

export async function unifiedSearch(query: string, userId?: string, source?: 'library' | 'discover'): Promise<UnifiedMedia[]> {
	const configs = getEnabledConfigs();

	// Use searchable adapters from registry instead of hardcoded exclusion sets
	const searchableIds = new Set(registry.searchable().map((a) => a.id));
	const searchPriority = Object.fromEntries(
		registry.searchable().map((a) => [a.id, a.searchPriority ?? Infinity])
	);

	// When Overseerr is present, skip radarr/sonarr to avoid duplicate results
	const hasOverseerr = configs.some((c) => c.type === 'overseerr');
	const overseerrRedundant = new Set(['radarr', 'sonarr']);

	const searchConfigs = configs.filter((c) => {
		if (!searchableIds.has(c.type)) return false;
		if (hasOverseerr && overseerrRedundant.has(c.type)) return false;
		if (source === 'library' && !LIBRARY_TYPES.has(c.type)) return false;
		if (source === 'discover' && LIBRARY_TYPES.has(c.type)) return false;
		return true;
	});

	const results = await Promise.allSettled(
		searchConfigs.map(async (config) => {
			const adapter = registry.get(config.type);
			const cred = resolveUserCred(config, userId);
			const result = await adapter?.search?.(config, query, cred);
			return (result?.items ?? []).map((item) => ({ ...item, _searchSource: config.type }));
		})
	);
	const allItems = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

	// Sort by adapter search priority (lower = higher priority)
	allItems.sort((a, b) => (searchPriority[a.serviceType] ?? Infinity) - (searchPriority[b.serviceType] ?? Infinity));

	return allItems;
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
// Auto-discovery & linking
// ---------------------------------------------------------------------------

export interface AutoLinkResult {
	externalUsername: string;
	externalId: string;
	nexusUsername?: string;
	nexusUserId?: string;
	status: 'linked' | 'already-linked' | 'no-match' | 'error';
	error?: string;
}

export async function autoDiscoverAndLink(serviceId: string): Promise<AutoLinkResult[]> {
	const config = getServiceConfig(serviceId);
	if (!config) throw new Error(`Service not found: ${serviceId}`);

	const adapter = registry.get(config.type);
	if (!adapter) throw new Error(`No adapter registered for type: ${config.type}`);
	if (!adapter.getUsers) throw new Error(`Adapter ${config.type} does not support getUsers`);

	const externalUsers = await adapter.getUsers(config);
	const nexusUsers = getAllUsers();

	// Build a map of already-linked external user IDs for this service
	const linkedExternalIds = new Set<string>();
	for (const nexusUser of nexusUsers) {
		const cred = getUserCredentialForService(nexusUser.id, serviceId);
		if (cred?.externalUserId) {
			linkedExternalIds.add(cred.externalUserId);
		}
	}

	const results: AutoLinkResult[] = [];

	for (const externalUser of externalUsers) {
		// Already linked — skip
		if (linkedExternalIds.has(externalUser.externalId)) {
			// Find which Nexus user has this credential
			const linkedNexus = nexusUsers.find((u) => {
				const c = getUserCredentialForService(u.id, serviceId);
				return c?.externalUserId === externalUser.externalId;
			});
			results.push({
				externalUsername: externalUser.username,
				externalId: externalUser.externalId,
				nexusUsername: linkedNexus?.username,
				nexusUserId: linkedNexus?.id,
				status: 'already-linked'
			});
			continue;
		}

		// Find a matching Nexus user by username (case-insensitive)
		const match = nexusUsers.find(
			(u) => u.username.toLowerCase() === externalUser.username.toLowerCase()
		);

		if (!match) {
			results.push({
				externalUsername: externalUser.username,
				externalId: externalUser.externalId,
				status: 'no-match'
			});
			continue;
		}

		try {
			if (adapter.resetPassword && adapter.authenticateUser) {
				const tempPw = randomBytes(24).toString('base64url');
				await adapter.resetPassword(config, externalUser.externalId, tempPw);
				const result = await adapter.authenticateUser(config, match.username, tempPw);
				upsertUserCredential(match.id, serviceId, result);

				// Cascade dependent service links for Jellyfin-based services
				await autoLinkJellyfinServices(match.id);

				results.push({
					externalUsername: externalUser.username,
					externalId: externalUser.externalId,
					nexusUsername: match.username,
					nexusUserId: match.id,
					status: 'linked'
				});
			} else {
				results.push({
					externalUsername: externalUser.username,
					externalId: externalUser.externalId,
					nexusUsername: match.username,
					nexusUserId: match.id,
					status: 'error',
					error: 'Adapter does not support password reset or authentication'
				});
			}
		} catch (e) {
			results.push({
				externalUsername: externalUser.username,
				externalId: externalUser.externalId,
				nexusUsername: match.username,
				nexusUserId: match.id,
				status: 'error',
				error: e instanceof Error ? e.message : String(e)
			});
		}
	}

	return results;
}

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------

const PING_TIMEOUT_MS = 5000;

export async function checkAllServices(): Promise<ServiceHealth[]> {
	const result = await withCache('health', 30_000, () => checkAllServicesUncached());
	// If any service is offline, use a shorter cache so recovery is detected quickly
	if (result.some((h) => !h.online)) {
		invalidate('health');
	}
	return result;
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
