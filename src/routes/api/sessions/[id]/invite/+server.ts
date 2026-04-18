import { json } from '@sveltejs/kit';
import { getWatchSession, areFriends, inviteToSession } from '$lib/server/social';
import { broadcastToUser } from '$lib/server/ws';
import { createNotificationIfEnabled } from '$lib/server/notifications';
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

	const inviterName = locals.user.displayName || locals.user.username;
	const sessionTitle = session.mediaTitle ?? 'a session';

	let invited = 0;
	for (const uid of friendUserIds) {
		// CANONICAL: session invites persist via notifications so offline users
		// see them when they return. WS event below is still fired for online
		// users — but display/recovery source of truth is the notifications row. (#35)
		createNotificationIfEnabled({
			userId: uid,
			type: 'session_invite',
			title: `${inviterName} invited you to watch ${sessionTitle}`,
			message: session.mediaTitle ?? undefined,
			icon: 'Play',
			actorId: locals.user.id,
			metadata: {
				sessionId: params.id,
				mediaTitle: session.mediaTitle,
				mediaType: session.mediaType,
				sessionType: session.type,
				inviterId: locals.user.id,
				inviterName
			}
		});

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
