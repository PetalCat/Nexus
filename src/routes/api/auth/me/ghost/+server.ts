import { json } from '@sveltejs/kit';
import { updatePresence, getPresence, getFriendIds } from '$lib/server/social';
import { broadcastToFriends } from '$lib/server/ws';
import type { RequestHandler } from './$types';

// PUT /api/auth/me/ghost — toggle ghost mode
// Body: { enabled: boolean }
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { enabled } = await request.json();
	if (typeof enabled !== 'boolean') return json({ error: 'enabled must be boolean' }, { status: 400 });

	updatePresence(locals.user.id, { ghostMode: enabled });

	// When going ghost: appear offline to friends
	// When leaving ghost: broadcast real status
	const presence = getPresence(locals.user.id);
	broadcastToFriends(locals.user.id, {
		type: 'presence:updated',
		data: {
			userId: locals.user.id,
			status: enabled ? 'offline' : (presence?.status ?? 'online'),
			customStatus: enabled ? null : presence?.customStatus
		}
	}, () => getFriendIds(locals.user!.id));

	return json({ ok: true, ghostMode: enabled });
};
