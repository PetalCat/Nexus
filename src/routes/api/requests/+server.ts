import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getUserCredentialForService } from '$lib/server/auth';
import { getEnabledConfigs } from '$lib/server/services';
import { withCache, invalidatePrefix } from '$lib/server/cache';
import type { NexusRequest } from '$lib/adapters/types';
import {
	hasOverseerrEnabled,
	getArrServiceForType,
	createNativeRequest,
	reactivateNativeRequest,
	findExistingNativeRequest,
	getNativeRequests,
	getNativeRequestById,
	approveNativeRequest,
	declineNativeRequest,
	nativeToNexusRequest,
	type NativeMediaType
} from '$lib/server/media-requests';
import type { RequestHandler } from './$types';

// GET /api/requests?filter=all|pending|approved|declined|available
// Merges Overseerr-proxied requests (when an Overseerr service is enabled) with
// native media_requests rows. Admins see all; users see only their own.
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const filter = (url.searchParams.get('filter') ?? 'all') as 'all' | 'pending' | 'approved' | 'declined' | 'available';
	const isAdmin = locals.user.isAdmin;
	const userId = locals.user.id;

	// Overseerr-proxied requests (cached). Native rows are read live (cheap, local DB).
	const cacheKey = isAdmin
		? `api-requests:admin:${filter}`
		: `api-requests:user:${userId}:${filter}`;

	const overseerrRequests = await withCache(cacheKey, 30_000, async () => {
		const configs = getEnabledConfigs().filter((c) => {
			const adapter = registry.get(c.type);
			return !!adapter?.getRequests;
		});
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

		return reqs;
	});

	// Native rows.
	const nativeRequests = getNativeRequests({ userId, isAdmin }).map(nativeToNexusRequest);

	// Merge + dedupe by (tmdbId, type). Native rows take precedence when both exist.
	const merged: NexusRequest[] = [...nativeRequests];
	const seen = new Set(nativeRequests.map((r) => `${r.tmdbId ?? r.sourceId}:${r.type}`));
	for (const r of overseerrRequests) {
		const key = `${r.tmdbId ?? r.sourceId}:${r.type}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(r);
	}

	merged.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());

	return json({ requests: merged });
};

// PATCH /api/requests — approve or deny one or more requests (admin only)
// Body: { action: 'approve' | 'deny', ids: string[], reason?: string }
// ids are composite: `${serviceId}:${sourceId}`. For native requests sourceId is
// the media_requests row id; for Overseerr it's the Overseerr request id.
export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const adminId = locals.user.id;
	const body = await request.json();
	const { action, ids, reason }: { action: 'approve' | 'deny'; ids: string[]; reason?: string } = body;

	if (!action || !Array.isArray(ids) || ids.length === 0) {
		return json({ error: 'Missing action or ids' }, { status: 400 });
	}

	const results = await Promise.allSettled(
		ids.map(async (compositeId) => {
			const sep = compositeId.indexOf(':');
			if (sep === -1) throw new Error(`Invalid id: ${compositeId}`);
			const sourceId = compositeId.slice(sep + 1);

			// Native request? (sourceId matches a media_requests row)
			const native = getNativeRequestById(sourceId);
			if (native) {
				if (action === 'approve') {
					await approveNativeRequest(native, adminId);
				} else {
					declineNativeRequest(native, adminId, reason);
				}
				return true;
			}

			// Otherwise Overseerr-proxied — resolve by serviceId.
			const serviceId = compositeId.slice(0, sep);
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

	if (succeeded > 0) {
		invalidatePrefix('api-requests:');
		invalidatePrefix('requests:');
		invalidatePrefix('pending-count:');
		invalidatePrefix('admin-requests');
	}

	return json({ succeeded, failed });
};

// POST /api/requests — create a new media request.
// Body: { serviceId?, tmdbId, type: 'movie'|'tv', title?, poster?, year?, seasons? }
//
// Backend selection:
//   - Overseerr enabled → proxy to Overseerr (existing behavior; serviceId required).
//   - Else native       → insert a media_requests row (status 'pending') and pick
//                         the Radarr/Sonarr service automatically.
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const {
		serviceId,
		tmdbId,
		type,
		seasons,
		title,
		poster,
		year
	}: {
		serviceId?: string;
		tmdbId: string | number;
		type: 'movie' | 'tv';
		seasons?: number[];
		title?: string;
		poster?: string;
		year?: number;
	} = body;

	if (tmdbId == null || !type) {
		return json({ error: 'Missing tmdbId or type' }, { status: 400 });
	}
	if (type !== 'movie' && type !== 'tv') {
		return json({ error: 'type must be movie or tv' }, { status: 400 });
	}

	// ── Overseerr path (unchanged) ──────────────────────────────────────────
	if (hasOverseerrEnabled()) {
		const configs = getEnabledConfigs();
		// Prefer the explicit serviceId; fall back to the first enabled Overseerr.
		const config =
			(serviceId && configs.find((c) => c.id === serviceId && c.type === 'overseerr')) ||
			configs.find((c) => c.type === 'overseerr');
		if (!config) return json({ error: 'Overseerr service not found' }, { status: 404 });

		const adapter = registry.get('overseerr');
		if (!adapter?.requestMedia) return json({ error: 'Not supported' }, { status: 400 });

		const cred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
		const ok = await adapter.requestMedia(config, String(tmdbId), type, cred, seasons);

		if (ok) {
			invalidatePrefix('api-requests:');
			invalidatePrefix('requests:');
			invalidatePrefix('pending-count:');
			invalidatePrefix('admin-requests');
		}

		return json({ ok, backend: 'overseerr' });
	}

	// ── Native path ─────────────────────────────────────────────────────────
	const numericTmdb = typeof tmdbId === 'number' ? tmdbId : parseInt(String(tmdbId), 10);
	if (!Number.isFinite(numericTmdb)) {
		return json({ error: 'Invalid tmdbId' }, { status: 400 });
	}
	const mediaType = type as NativeMediaType;

	const arr = getArrServiceForType(mediaType);
	if (!arr) {
		return json(
			{ error: `No enabled ${mediaType === 'movie' ? 'Radarr' : 'Sonarr'} service to request from` },
			{ status: 400 }
		);
	}

	// Sanitize client-supplied seasons → non-negative integers only.
	const cleanSeasons = Array.isArray(seasons)
		? seasons.map((s) => Number(s)).filter((n) => Number.isInteger(n) && n >= 0)
		: null;

	// Dedupe on (userId, tmdbId, mediaType). A previously-DECLINED request may be
	// re-opened as a fresh pending re-request; any other existing status is a dup.
	const existing = findExistingNativeRequest(locals.user.id, numericTmdb, mediaType);
	if (existing && existing.status !== 'declined') {
		return json({ ok: true, backend: 'native', duplicate: true, requestId: existing.id, status: existing.status });
	}

	let created;
	try {
		created =
			existing && existing.status === 'declined'
				? reactivateNativeRequest(existing, {
						title: title ?? `tmdb:${numericTmdb}`,
						poster: poster ?? null,
						year: year ?? null,
						seasons: cleanSeasons,
						serviceId: arr.id
					})
				: createNativeRequest({
						userId: locals.user.id,
						mediaType,
						tmdbId: numericTmdb,
						title: title ?? `tmdb:${numericTmdb}`,
						poster: poster ?? null,
						year: year ?? null,
						seasons: cleanSeasons,
						serviceId: arr.id
					});
	} catch (e) {
		// Concurrent insert raced the unique (user,tmdb,type) index → treat as dup.
		if (/UNIQUE|SQLITE_CONSTRAINT/.test(String(e))) {
			const dup = findExistingNativeRequest(locals.user.id, numericTmdb, mediaType);
			return json({ ok: true, backend: 'native', duplicate: true, requestId: dup?.id, status: dup?.status });
		}
		throw e;
	}

	invalidatePrefix('api-requests:');
	invalidatePrefix('requests:');
	invalidatePrefix('pending-count:');
	invalidatePrefix('admin-requests');

	return json({ ok: true, backend: 'native', requestId: created.id, status: created.status });
};
