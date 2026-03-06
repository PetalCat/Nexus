import { json } from '@sveltejs/kit';
import { getWatchSession, updateWatchSessionStatus, getSessionParticipantIds } from '$lib/server/social';
import { broadcastToUsers } from '$lib/server/ws';
import type { RequestHandler } from './$types';

// GET /api/sessions/:id — session detail
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const session = getWatchSession(params.id);
	if (!session) return json({ error: 'Not found' }, { status: 404 });

	return json({ session });
};

// PUT /api/sessions/:id — update session status (host only)
// Body: { status: 'playing' | 'paused' | 'ended' }
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { status } = await request.json();
	const validStatuses = ['waiting', 'playing', 'paused', 'ended'];
	if (!validStatuses.includes(status)) {
		return json({ error: 'Invalid status' }, { status: 400 });
	}

	const ok = updateWatchSessionStatus(params.id, locals.user.id, status);
	if (!ok) return json({ error: 'Not found or not host' }, { status: 403 });

	// Broadcast status change to participants
	const participantIds = getSessionParticipantIds(params.id);
	broadcastToUsers(participantIds, {
		type: 'session:status_changed',
		data: { sessionId: params.id, status, changedBy: locals.user.id }
	}, locals.user.id);

	return json({ ok: true });
};

// DELETE /api/sessions/:id — end session (host only)
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const ok = updateWatchSessionStatus(params.id, locals.user.id, 'ended');
	if (!ok) return json({ error: 'Not found or not host' }, { status: 403 });

	const participantIds = getSessionParticipantIds(params.id);
	broadcastToUsers(participantIds, {
		type: 'session:status_changed',
		data: { sessionId: params.id, status: 'ended', changedBy: locals.user.id }
	}, locals.user.id);

	return json({ ok: true });
};
