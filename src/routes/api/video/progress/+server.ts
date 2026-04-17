import { json } from '@sveltejs/kit';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { broadcastToFriends } from '$lib/server/ws';
import { getFriendIds } from '$lib/server/social';
import {
	upsertPlaySession,
	getLatestSession
} from '$lib/server/play-sessions';
import type { RequestHandler } from './$types';

/**
 * Video playback progress tracking for Invidious. Writes to the canonical
 * `play_sessions` table.
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

	const { videoId, positionSeconds, durationSeconds, isStopped, isStart, title } = body;
	if (!videoId) return json({ error: 'Missing videoId' }, { status: 400 });

	const userId = locals.user.id;
	const progress =
		typeof durationSeconds === 'number' && durationSeconds > 0
			? Math.min(positionSeconds / durationSeconds, 1)
			: null;
	const positionTicks = Math.round((positionSeconds ?? 0) * 10_000_000);
	const mediaDurationMs =
		typeof durationSeconds === 'number' && durationSeconds > 0
			? Math.round(durationSeconds * 1000)
			: null;

	// Find Invidious service
	const invConfig = getConfigsForMediaType('video')[0];
	const serviceId = invConfig?.id ?? 'invidious';
	const serviceType = invConfig?.type ?? 'invidious';

	const isComplete = progress != null && progress >= 0.9;

	upsertPlaySession({
		userId,
		serviceId,
		serviceType,
		mediaId: videoId,
		mediaType: 'video',
		mediaTitle: title ?? null,
		sessionKey: `invidious:${videoId}:${userId}`,
		progress,
		positionTicks,
		mediaDurationMs,
		source: 'invidious-progress',
		stopped: isStopped === true,
		completed: isComplete
	});

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
			const adapter = registry.get(invConfig.type);
			adapter?.setItemStatus?.(invConfig, videoId, { watched: true }, userCred).catch(() => {});
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

	const record = getLatestSession(locals.user.id, serviceId, videoId);

	if (!record) return json({ progress: 0, positionSeconds: 0, completed: false });

	return json({
		progress: record.progress ?? 0,
		positionSeconds: record.position_ticks ? record.position_ticks / 10_000_000 : 0,
		completed: !!record.completed
	});
};
