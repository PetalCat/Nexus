/**
 * Native media request service — the "no-Overseerr" path.
 *
 * Users create rows in `media_requests`; an admin approves them, at which point
 * the item is pushed into Radarr (movies) or Sonarr (TV) for download. This
 * lives ALONGSIDE the Overseerr proxy path (see src/lib/adapters/overseerr.ts);
 * the request routes pick a backend based on which services are enabled.
 */

import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import type { MediaRequest, NewMediaRequest } from '../db/schema';
import type { NexusRequest, ServiceConfig } from '../adapters/types';
import { getEnabledConfigs } from './services';
import { isOverseerrType } from '../adapters/overseerr';
import { radarrRequestMedia } from '../adapters/radarr';
import { sonarrRequestMedia } from '../adapters/sonarr';
import { createNotification } from './notifications';
import { getUserById } from './auth';

export type NativeMediaType = 'movie' | 'tv';

function genId(): string {
	return randomBytes(16).toString('hex');
}

/**
 * Per-service webhook token = HMAC(secret, serviceId). The arr download webhook
 * is unauthenticated (the *arr can't send auth headers), so the URL must carry
 * this high-entropy token — a guessed/forged serviceId alone can't drive request
 * completion. Decoupled from the user-facing (Math.random-derived) service id.
 */
export function arrWebhookToken(serviceId: string): string {
	const secret = process.env.BETTER_AUTH_SECRET ?? '';
	return createHmac('sha256', secret).update(`arr-webhook:${serviceId}`).digest('hex').slice(0, 32);
}

/** Constant-time validation of the arr webhook token. */
export function verifyArrWebhookToken(serviceId: string, token: string | null | undefined): boolean {
	if (!token) return false;
	const a = Buffer.from(token);
	const b = Buffer.from(arrWebhookToken(serviceId));
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Re-open a previously-declined request as a fresh pending re-request (the
 *  unique (user,tmdb,type) index means we update the existing row, not insert). */
export function reactivateNativeRequest(
	req: MediaRequest,
	input: { title: string; poster?: string | null; year?: number | null; seasons?: number[] | null; serviceId: string }
): MediaRequest {
	const db = getDb();
	const now = Date.now();
	db.update(schema.mediaRequests)
		.set({
			status: 'pending',
			title: input.title,
			poster: input.poster ?? null,
			year: input.year ?? null,
			seasons: input.seasons && input.seasons.length ? JSON.stringify(input.seasons) : null,
			serviceId: input.serviceId,
			declineReason: null,
			approvedBy: null,
			updatedAt: now
		})
		.where(eq(schema.mediaRequests.id, req.id))
		.run();
	return { ...req, status: 'pending', updatedAt: now };
}

/** True when an Overseerr/Seerr service is enabled — preferred backend when present. */
export function hasOverseerrEnabled(): boolean {
	return getEnabledConfigs().some((c) => isOverseerrType(c.type));
}

/** Find the enabled Radarr service (movies) or Sonarr service (TV), if any. */
export function getArrServiceForType(mediaType: NativeMediaType): ServiceConfig | undefined {
	const wantType = mediaType === 'movie' ? 'radarr' : 'sonarr';
	return getEnabledConfigs().find((c) => c.type === wantType);
}

/** A native request the user already has for this (tmdbId, mediaType), if any. */
export function findExistingNativeRequest(
	userId: string,
	tmdbId: number,
	mediaType: NativeMediaType
): MediaRequest | undefined {
	const db = getDb();
	return db
		.select()
		.from(schema.mediaRequests)
		.where(
			and(
				eq(schema.mediaRequests.userId, userId),
				eq(schema.mediaRequests.tmdbId, tmdbId),
				eq(schema.mediaRequests.mediaType, mediaType)
			)
		)
		.get();
}

export interface CreateNativeRequestInput {
	userId: string;
	mediaType: NativeMediaType;
	tmdbId: number;
	title: string;
	poster?: string | null;
	year?: number | null;
	seasons?: number[] | null;
	serviceId: string;
}

/** Insert a new native request row (status 'pending'). Caller handles dedupe. */
export function createNativeRequest(input: CreateNativeRequestInput): MediaRequest {
	const db = getDb();
	const now = Date.now();
	const row: NewMediaRequest = {
		id: genId(),
		userId: input.userId,
		mediaType: input.mediaType,
		tmdbId: input.tmdbId,
		tvdbId: null,
		title: input.title,
		poster: input.poster ?? null,
		year: input.year ?? null,
		seasons: input.seasons && input.seasons.length ? JSON.stringify(input.seasons) : null,
		status: 'pending',
		backend: 'native',
		serviceId: input.serviceId,
		sourceRequestId: null,
		arrServiceId: null,
		arrItemId: null,
		qualityProfileId: null,
		rootFolderPath: null,
		approvedBy: null,
		declineReason: null,
		createdAt: now,
		updatedAt: now,
		availableAt: null
	};
	db.insert(schema.mediaRequests).values(row).run();
	return row as MediaRequest;
}

/** Native rows for a user (or all rows for admins), newest first. */
export function getNativeRequests(opts: { userId: string; isAdmin: boolean }): MediaRequest[] {
	const db = getDb();
	const q = db.select().from(schema.mediaRequests).orderBy(desc(schema.mediaRequests.createdAt));
	if (opts.isAdmin) return q.all();
	return db
		.select()
		.from(schema.mediaRequests)
		.where(eq(schema.mediaRequests.userId, opts.userId))
		.orderBy(desc(schema.mediaRequests.createdAt))
		.all();
}

export function getNativeRequestById(id: string): MediaRequest | undefined {
	const db = getDb();
	return db.select().from(schema.mediaRequests).where(eq(schema.mediaRequests.id, id)).get();
}

/**
 * Approve a pending native request: push it into Radarr/Sonarr and mark it
 * 'processing'. Throws if the arr service is missing or the add fails (the
 * caller should leave the row 'pending' / surface the error).
 */
export async function approveNativeRequest(req: MediaRequest, approvedById: string): Promise<MediaRequest> {
	const db = getDb();
	// Only a pending request may be approved — guard against double-approve / replay
	// (which would re-POST to the arr and reset availableAt).
	if (req.status !== 'pending') {
		throw new Error(`Request is '${req.status}', not pending — cannot approve`);
	}
	const arr = getArrServiceForType(req.mediaType as NativeMediaType);
	if (!arr) throw new Error(`No enabled ${req.mediaType === 'movie' ? 'Radarr' : 'Sonarr'} service`);

	let arrItemId: number;
	let qualityProfileId: number;
	let rootFolderPath: string;
	let tvdbId: number | null = req.tvdbId;

	if (req.mediaType === 'movie') {
		const result = await radarrRequestMedia(arr, { tmdbId: req.tmdbId, title: req.title });
		arrItemId = result.arrItemId;
		qualityProfileId = result.qualityProfileId;
		rootFolderPath = result.rootFolderPath;
	} else {
		// seasons is server-written JSON, but parse defensively so a malformed value
		// can't make the request permanently un-approvable.
		let seasons: number[] | undefined;
		try {
			seasons = req.seasons ? (JSON.parse(req.seasons) as number[]) : undefined;
		} catch {
			seasons = undefined;
		}
		const result = await sonarrRequestMedia(arr, { tmdbId: req.tmdbId, title: req.title, seasons });
		arrItemId = result.arrItemId;
		qualityProfileId = result.qualityProfileId;
		rootFolderPath = result.rootFolderPath;
		tvdbId = result.tvdbId;
	}

	const now = Date.now();
	db.update(schema.mediaRequests)
		.set({
			status: 'processing',
			arrServiceId: arr.id,
			arrItemId,
			qualityProfileId,
			rootFolderPath,
			tvdbId,
			approvedBy: approvedById,
			declineReason: null,
			updatedAt: now
		})
		.where(eq(schema.mediaRequests.id, req.id))
		.run();

	// Notify the requester that their request was approved.
	try {
		createNotification({
			userId: req.userId,
			type: 'request_approved',
			title: 'Request approved',
			message: `"${req.title}" was approved and is now downloading`,
			icon: 'check-circle',
			href: '/requests',
			actorId: approvedById,
			metadata: { requestId: req.id, tmdbId: req.tmdbId, mediaType: req.mediaType }
		});
	} catch {
		/* notification failure must not fail the approval */
	}

	return { ...req, status: 'processing', arrServiceId: arr.id, arrItemId, qualityProfileId, rootFolderPath, tvdbId, approvedBy: approvedById, updatedAt: now };
}

/** Decline a native request. */
export function declineNativeRequest(req: MediaRequest, approvedById: string, reason?: string): MediaRequest {
	const db = getDb();
	const now = Date.now();
	db.update(schema.mediaRequests)
		.set({ status: 'declined', declineReason: reason ?? null, approvedBy: approvedById, updatedAt: now })
		.where(eq(schema.mediaRequests.id, req.id))
		.run();

	try {
		createNotification({
			userId: req.userId,
			type: 'system',
			title: 'Request declined',
			message: reason ? `"${req.title}" was declined: ${reason}` : `"${req.title}" was declined`,
			icon: 'x-circle',
			href: '/requests',
			actorId: approvedById,
			metadata: { requestId: req.id, tmdbId: req.tmdbId, mediaType: req.mediaType }
		});
	} catch {
		/* ignore */
	}

	return { ...req, status: 'declined', declineReason: reason ?? null, approvedBy: approvedById, updatedAt: now };
}

/**
 * Mark a request available (called by the arr download/import webhook). Matches
 * by arr item id when known, else by tmdb/tvdb id. Fires a 'request_available'
 * notification. Returns the updated rows (may be >1 if multiple users requested
 * the same title).
 */
export function markRequestsAvailable(opts: {
	mediaType: NativeMediaType;
	tmdbId?: number | null;
	tvdbId?: number | null;
	arrServiceId?: string | null;
	arrItemId?: number | null;
}): MediaRequest[] {
	const db = getDb();

	// Gather candidate rows for this media type that aren't already available/declined.
	const candidates = db
		.select()
		.from(schema.mediaRequests)
		.where(eq(schema.mediaRequests.mediaType, opts.mediaType))
		.all();

	const matched = candidates.filter((r) => {
		if (r.status === 'available' || r.status === 'declined') return false;
		// A row already bound to a specific arr service can ONLY be completed by a
		// webhook from THAT service — stops a webhook authenticated as service X
		// (or a forged one) from flipping a request tied to service Y on a bare
		// tmdb/tvdb match.
		if (r.arrServiceId && opts.arrServiceId && r.arrServiceId !== opts.arrServiceId) return false;
		// Prefer exact arr item match when we have it.
		if (opts.arrServiceId && opts.arrItemId != null && r.arrServiceId === opts.arrServiceId && r.arrItemId === opts.arrItemId) {
			return true;
		}
		if (opts.tmdbId != null && r.tmdbId === opts.tmdbId) return true;
		if (opts.tvdbId != null && r.tvdbId != null && r.tvdbId === opts.tvdbId) return true;
		return false;
	});

	const now = Date.now();
	for (const r of matched) {
		db.update(schema.mediaRequests)
			.set({ status: 'available', availableAt: now, updatedAt: now })
			.where(eq(schema.mediaRequests.id, r.id))
			.run();

		try {
			createNotification({
				userId: r.userId,
				type: 'request_available',
				title: 'Now available',
				message: `"${r.title}" is ready to watch`,
				icon: 'play-circle',
				href: '/requests',
				metadata: { requestId: r.id, tmdbId: r.tmdbId, mediaType: r.mediaType }
			});
		} catch {
			/* ignore */
		}
	}

	return matched.map((r) => ({ ...r, status: 'available', availableAt: now, updatedAt: now }));
}

/** Map a native request status onto the NexusRequest status union. */
function mapNativeStatus(status: string): NexusRequest['status'] {
	switch (status) {
		case 'approved':
		case 'processing':
			return 'approved';
		case 'declined':
			return 'declined';
		case 'available':
			return 'available';
		case 'failed':
			return 'declined';
		default:
			return 'pending';
	}
}

/** Normalize a native request row into the unified NexusRequest shape. */
export function nativeToNexusRequest(r: MediaRequest): NexusRequest {
	const requester = getUserById(r.userId);
	return {
		id: `${r.serviceId}:${r.id}`,
		sourceId: r.id,
		serviceId: r.serviceId,
		serviceType: 'native',
		serviceName: r.mediaType === 'movie' ? 'Radarr' : 'Sonarr',
		title: r.title,
		type: r.mediaType === 'movie' ? 'movie' : 'show',
		poster: r.poster ?? undefined,
		year: r.year ?? undefined,
		status: mapNativeStatus(r.status),
		requestedByName: requester?.displayName ?? requester?.username ?? 'Unknown',
		requestedByExternalId: r.userId,
		requestedAt: new Date(r.createdAt).toISOString(),
		updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : undefined,
		tmdbId: String(r.tmdbId)
	};
}
