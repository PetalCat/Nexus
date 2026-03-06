import { json } from '@sveltejs/kit';
import { leaveWatchSession, getSessionParticipantIds } from '$lib/server/social';
import { broadcastToUsers } from '$lib/server/ws';
import type { RequestHandler } from './$types';

// POST /api/sessions/:id/leave
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const ok = leaveWatchSession(params.id, locals.user.id);
	if (!ok) return json({ error: 'Not in session' }, { status: 400 });

	const participantIds = getSessionParticipantIds(params.id);
	broadcastToUsers(participantIds, {
		type: 'session:participant_left',
		data: {
			sessionId: params.id,
			userId: locals.user.id,
			username: locals.user.username,
			displayName: locals.user.displayName
		}
	});

	return json({ ok: true });
};
