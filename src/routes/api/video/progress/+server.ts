import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { activity } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { markWatched } from '$lib/adapters/invidious';
import { broadcastToFriends } from '$lib/server/ws';
import { getFriendIds } from '$lib/server/social';
import type { RequestHandler } from './$types';

/**
 * Video playback progress tracking for Invidious.
 *
 * POST — report play state (start, progress, pause, stop)
 * GET  — get current progress for a video
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const { videoId, positionSeconds, durationSeconds, isPaused, isStopped, isStart, title } = body;
	if (!videoId) return json({ error: 'Missing videoId' }, { status: 400 });

	const userId = locals.user.id;
	const db = getDb();
	const progress = durationSeconds > 0 ? Math.min(positionSeconds / durationSeconds, 1) : 0;
	const positionTicks = Math.round((positionSeconds ?? 0) * 10_000_000);

	// Find Invidious service
	const invConfig = getConfigsForMediaType('video')[0];
	const serviceId = invConfig?.id ?? 'invidious';

	// Upsert activity record
	const existing = db.select().from(activity)
		.where(and(eq(activity.userId, userId), eq(activity.mediaId, videoId), eq(activity.serviceId, serviceId)))
		.get();

	const isComplete = progress >= 0.9;

	if (existing) {
		db.update(activity)
			.set({
				progress,
				positionTicks,
				completed: isComplete,
				lastActivity: new Date().toISOString()
			})
			.where(eq(activity.id, existing.id))
			.run();
	} else {
		db.insert(activity).values({
			userId,
			mediaId: videoId,
			serviceId,
			type: 'watch',
			progress,
			positionTicks,
			completed: isComplete,
			lastActivity: new Date().toISOString()
		}).run();
	}

	// Broadcast activity to friends on start/stop
	if (isStart || isStopped) {
		broadcastToFriends(userId, {
			type: isStart ? 'presence:activity_started' : 'presence:activity_stopped',
			data: isStart ? {
				userId,
				activity: { type: 'watching', mediaType: 'video', title, videoId, service: 'invidious' }
			} : { userId }
		}, () => getFriendIds(userId));
	}

	// Mark as watched on Invidious when video is complete or stopped past 90%
	if (isComplete && invConfig) {
		const userCred = getUserCredentialForService(userId, invConfig.id) ?? undefined;
		if (userCred) {
			markWatched(invConfig, videoId, userCred).catch(() => {});
		}
	}

	return json({ ok: true, progress });
};

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const videoId = url.searchParams.get('videoId');
	if (!videoId) return json({ error: 'Missing videoId' }, { status: 400 });

	const invConfig = getConfigsForMediaType('video')[0];
	const serviceId = invConfig?.id ?? 'invidious';

	const db = getDb();
	const record = db.select().from(activity)
		.where(and(eq(activity.userId, locals.user.id), eq(activity.mediaId, videoId), eq(activity.serviceId, serviceId)))
		.get();

	if (!record) return json({ progress: 0, positionSeconds: 0, completed: false });

	return json({
		progress: record.progress,
		positionSeconds: record.positionTicks ? record.positionTicks / 10_000_000 : 0,
		completed: record.completed
	});
};
