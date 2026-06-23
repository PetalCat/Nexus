import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { heartbeat } from '$lib/server/playback-sessions';

/**
 * POST /api/play/heartbeat  { sessionId }
 * Keepalive: the player pings this every ~10s while playing so the reaper knows
 * the session is alive. Only the owning user can keep their session alive.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	let body: { sessionId?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	if (!body.sessionId) return json({ error: 'Missing sessionId' }, { status: 400 });
	const ok = heartbeat(body.sessionId, locals.user.id);
	// 410 Gone if the session was already reaped — tells the player to re-negotiate.
	return ok ? json({ ok: true }) : json({ ok: false, gone: true }, { status: 410 });
};
