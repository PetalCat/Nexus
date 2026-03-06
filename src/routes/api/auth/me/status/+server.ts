import { json } from '@sveltejs/kit';
import { updatePresence, isGhostMode, getFriendIds } from '$lib/server/social';
import { broadcastToFriends } from '$lib/server/ws';
import type { RequestHandler } from './$types';

// PUT /api/auth/me/status — update presence status / custom status
// Body: { status?: string, customStatus?: string | null }
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { status, customStatus } = body;

	const validStatuses = ['online', 'away', 'dnd', 'offline'];
	if (status && !validStatuses.includes(status)) {
		return json({ error: 'Invalid status' }, { status: 400 });
	}

	const updates: Record<string, unknown> = {};
	if (status !== undefined) updates.status = status;
	if (customStatus !== undefined) updates.customStatus = customStatus;

	updatePresence(locals.user.id, updates);

	// Broadcast to friends if not ghost
	if (!isGhostMode(locals.user.id)) {
		broadcastToFriends(locals.user.id, {
			type: 'presence:updated',
			data: { userId: locals.user.id, status, customStatus }
		}, () => getFriendIds(locals.user!.id));
	}

	return json({ ok: true });
};
