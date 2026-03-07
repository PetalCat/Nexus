import { json } from '@sveltejs/kit';
import { acceptFriendRequest, declineFriendRequest } from '$lib/server/social';
import { broadcastToUser } from '$lib/server/ws';
import { createNotification } from '$lib/server/notifications';
import type { RequestHandler } from './$types';

// PUT /api/friends/requests/:id — accept or decline
// Body: { action: 'accept' | 'decline' }
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { action } = await request.json();
	if (action !== 'accept' && action !== 'decline') {
		return json({ error: 'Invalid action' }, { status: 400 });
	}

	if (action === 'accept') {
		const ok = acceptFriendRequest(params.id, locals.user.id);
		if (!ok) return json({ error: 'Request not found or not yours' }, { status: 404 });

		// Notify the sender that the request was accepted
		// We need the sender ID from the friendship — look it up
		const { getDb, schema } = await import('$lib/db');
		const { eq } = await import('drizzle-orm');
		const db = getDb();
		const row = db.select().from(schema.friendships).where(eq(schema.friendships.id, params.id)).get();
		if (row) {
			broadcastToUser(row.userId, {
				type: 'presence:notification',
				data: {
					notificationType: 'friend_accepted',
					userId: locals.user.id,
					username: locals.user.username,
					displayName: locals.user.displayName
				}
			});

			// Persist notification
			createNotification({
				userId: row.userId,
				type: 'friend_accept',
				title: `${locals.user.displayName} accepted your friend request`,
				icon: 'user-check',
				href: '/friends',
				actorId: locals.user.id
			});
		}

		return json({ ok: true, action: 'accepted' });
	} else {
		const ok = declineFriendRequest(params.id, locals.user.id);
		if (!ok) return json({ error: 'Request not found or not yours' }, { status: 404 });
		return json({ ok: true, action: 'declined' });
	}
};
