import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stopSession } from '$lib/server/playback-sessions';

/**
 * POST /api/play/stop  { sessionId }
 * Clean teardown — the player navigator.sendBeacon()s this on tab close /
 * pagehide so the backend transcode stops immediately (the fast path; the
 * reaper is the backstop for crashes/lost-network). sendBeacon sends a POST
 * with the session cookie, so locals.user is populated.
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
	const ok = await stopSession(body.sessionId, locals.user.id);
	return json({ ok });
};
