import { json } from '@sveltejs/kit';
import { joinWatchSession, getSessionParticipantIds } from '$lib/server/social';
import { broadcastToUsers } from '$lib/server/ws';
import type { RequestHandler } from './$types';

// POST /api/sessions/:id/join
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const ok = joinWatchSession(params.id, locals.user.id);
	if (!ok) return json({ error: 'Cannot join session' }, { status: 400 });

	const participantIds = getSessionParticipantIds(params.id);
	broadcastToUsers(participantIds, {
		type: 'session:participant_joined',
		data: {
			sessionId: params.id,
			userId: locals.user.id,
			username: locals.user.username,
			displayName: locals.user.displayName
		}
	}, locals.user.id);

	return json({ ok: true });
};
