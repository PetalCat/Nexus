import { json } from '@sveltejs/kit';
import { getPendingRequests, sendFriendRequest } from '$lib/server/social';
import { broadcastToUser } from '$lib/server/ws';
import { createNotification } from '$lib/server/notifications';
import type { RequestHandler } from './$types';

// GET /api/friends/requests — list pending friend requests
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const requests = getPendingRequests(locals.user.id);
	return json({ requests });
};

// POST /api/friends/requests — send a friend request
// Body: { userId: string }
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { userId } = await request.json();
	if (!userId) return json({ error: 'Missing userId' }, { status: 400 });

	const result = sendFriendRequest(locals.user.id, userId);
	if ('error' in result) return json({ error: result.error }, { status: 400 });

	// Notify recipient via WS
	broadcastToUser(userId, {
		type: 'presence:notification',
		data: {
			notificationType: 'friend_request',
			fromUserId: locals.user.id,
			fromUsername: locals.user.username,
			fromDisplayName: locals.user.displayName,
			requestId: result.id
		}
	});

	// Persist notification
	createNotification({
		userId,
		type: 'friend_request',
		title: `${locals.user.displayName} sent you a friend request`,
		icon: 'user-plus',
		href: '/friends',
		actorId: locals.user.id,
		metadata: { requestId: result.id }
	});

	return json({ id: result.id });
};
