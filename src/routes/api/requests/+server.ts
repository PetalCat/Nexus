import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getUserCredentialForService, getUserCredentials } from '$lib/server/auth';
import { getEnabledConfigs } from '$lib/server/services';
import { withCache, invalidatePrefix } from '$lib/server/cache';
import type { NexusRequest } from '$lib/adapters/types';
import type { RequestHandler } from './$types';

// GET /api/requests?filter=all|pending|approved|declined|available
// Admin → fetches all from Overseerr via admin API key
// User  → fetches via their session cookie (Overseerr scopes to their own)
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const filter = (url.searchParams.get('filter') ?? 'all') as 'all' | 'pending' | 'approved' | 'declined' | 'available';
	const isAdmin = locals.user.isAdmin;
	const userId = locals.user.id;

	// Cache key: admins share one cache per filter, users get their own
	const cacheKey = isAdmin
		? `api-requests:admin:${filter}`
		: `api-requests:user:${userId}:${filter}`;

	const allRequests = await withCache(cacheKey, 30_000, async () => {
		const configs = getEnabledConfigs().filter((c) => c.type === 'overseerr');
		const reqs: NexusRequest[] = [];

		await Promise.allSettled(
			configs.map(async (config) => {
				const adapter = registry.get('overseerr');
				if (!adapter?.getRequests) return;

				let userCred = undefined;
				if (!isAdmin) {
					const cred = getUserCredentialForService(userId, config.id);
					userCred = cred ?? undefined;
				}

				const requests = await adapter.getRequests(config, { filter, take: 200 }, userCred);
				reqs.push(...requests);
			})
		);

		reqs.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
		return reqs;
	});

	return json({ requests: allRequests });
};

// PATCH /api/requests — approve or deny one or more requests (admin only)
// Body: { action: 'approve' | 'deny', ids: string[] }
// ids are composite: `${serviceId}:${sourceId}`
export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const body = await request.json();
	const { action, ids }: { action: 'approve' | 'deny'; ids: string[] } = body;

	if (!action || !Array.isArray(ids) || ids.length === 0) {
		return json({ error: 'Missing action or ids' }, { status: 400 });
	}

	const results = await Promise.allSettled(
		ids.map(async (compositeId) => {
			const sep = compositeId.indexOf(':');
			if (sep === -1) throw new Error(`Invalid id: ${compositeId}`);
			const serviceId = compositeId.slice(0, sep);
			const sourceId = compositeId.slice(sep + 1);

			const configs = getEnabledConfigs();
			const config = configs.find((c) => c.id === serviceId);
			if (!config) throw new Error(`Service not found: ${serviceId}`);

			const adapter = registry.get(config.type);
			if (!adapter) throw new Error(`No adapter for ${config.type}`);

			if (action === 'approve') {
				if (!adapter.approveRequest) throw new Error('Approve not supported');
				return adapter.approveRequest(config, sourceId);
			} else {
				if (!adapter.denyRequest) throw new Error('Deny not supported');
				return adapter.denyRequest(config, sourceId);
			}
		})
	);

	const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value).length;
	const failed = results.length - succeeded;

	// Invalidate all request caches + pending count after approve/deny
	if (succeeded > 0) {
		invalidatePrefix('api-requests:');
		invalidatePrefix('requests:');
		invalidatePrefix('pending-count:');
		invalidatePrefix('admin-requests');
	}

	return json({ succeeded, failed });
};

// POST /api/requests — create a new media request via Overseerr
// Body: { serviceId, tmdbId, type: 'movie'|'tv' }
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { serviceId, tmdbId, type }: { serviceId: string; tmdbId: string; type: 'movie' | 'tv' } = body;

	if (!serviceId || !tmdbId || !type) {
		return json({ error: 'Missing serviceId, tmdbId, or type' }, { status: 400 });
	}

	const configs = getEnabledConfigs();
	const config = configs.find((c) => c.id === serviceId && c.type === 'overseerr');
	if (!config) return json({ error: 'Service not found' }, { status: 404 });

	const adapter = registry.get('overseerr');
	if (!adapter?.requestMedia) return json({ error: 'Not supported' }, { status: 400 });

	const cred = getUserCredentialForService(locals.user.id, serviceId) ?? undefined;
	const ok = await adapter.requestMedia(config, tmdbId, type, cred);

	// Invalidate request caches after creating a new request
	if (ok) {
		invalidatePrefix('api-requests:');
		invalidatePrefix('requests:');
		invalidatePrefix('pending-count:');
		invalidatePrefix('admin-requests');
	}

	return json({ ok });
};
