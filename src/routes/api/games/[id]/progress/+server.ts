import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { upsertPlaySession } from '$lib/server/play-sessions';

/**
 * Games progress endpoint — drives the unified `play_sessions` writer for
 * RomM-hosted games. The embedded emulator page (`/play/[id]`) fires:
 *   - `start`     — on `ejs:gameStarted`
 *   - `heartbeat` — every 30s while the iframe is focused
 *   - `stop`      — on beforeunload / navigation / `ejs:gameStopped`
 *
 * We key by `romm:{serviceId}:{romId}:{userId}` so the same rom reopening in
 * a new tab updates the same open row (until the 2h idle threshold closes it).
 */

export const POST: RequestHandler = async ({ params, request, locals, url }) => {
	if (!locals.user) throw error(401);

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const event = body?.event as 'start' | 'heartbeat' | 'stop' | undefined;
	if (!event || !['start', 'heartbeat', 'stop'].includes(event)) {
		return json({ error: 'event must be one of start|heartbeat|stop' }, { status: 400 });
	}

	const romId = params.id;
	const serviceId =
		(url.searchParams.get('serviceId') || body.serviceId) ??
		getConfigsForMediaType('game')[0]?.id;
	if (!serviceId) return json({ error: 'No game service configured' }, { status: 400 });

	const title = typeof body.title === 'string' ? body.title : null;
	const userId = locals.user.id;
	const playSeconds =
		typeof body.playSeconds === 'number' && Number.isFinite(body.playSeconds)
			? Math.max(0, body.playSeconds)
			: 0;

	const row = upsertPlaySession({
		userId,
		serviceId,
		serviceType: 'romm',
		mediaId: romId,
		mediaType: 'game',
		mediaTitle: title,
		sessionKey: `romm:${serviceId}:${romId}:${userId}`,
		progress: null,
		mediaDurationMs: null,
		source: 'emulator',
		stopped: event === 'stop',
		// Game sessions never auto-complete; the player explicitly ends them.
		completed: false,
		metadata: playSeconds > 0 ? { playSeconds } : null
	});

	return json({ ok: true, sessionId: row.id });
};
