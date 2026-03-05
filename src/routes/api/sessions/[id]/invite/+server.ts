import { json } from '@sveltejs/kit';
import { getWatchSession, areFriends, inviteToSession } from '$lib/server/social';
import { broadcastToUser } from '$lib/server/ws';
import type { RequestHandler } from './$types';

// POST /api/sessions/:id/invite — invite friend(s)
// Body: { userIds: string[] }
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const session = getWatchSession(params.id);
	if (!session) return json({ error: 'Session not found' }, { status: 404 });

	const { userIds } = await request.json();
	if (!Array.isArray(userIds) || userIds.length === 0) {
		return json({ error: 'Missing userIds' }, { status: 400 });
	}

	// Filter to friends only
	const friendUserIds = userIds.filter((uid) => areFriends(locals.user!.id, uid));

	// Persist invite list on the session
	if (friendUserIds.length > 0) {
		inviteToSession(params.id, locals.user.id, friendUserIds);
	}

	let invited = 0;
	for (const uid of friendUserIds) {
		broadcastToUser(uid, {
			type: 'session:invite',
			data: {
				sessionId: params.id,
				mediaTitle: session.mediaTitle,
				mediaType: session.mediaType,
				type: session.type,
				fromUserId: locals.user.id,
				fromUsername: locals.user.username,
				fromDisplayName: locals.user.displayName
			}
		});
		invited++;
	}

	return json({ ok: true, invited });
};
