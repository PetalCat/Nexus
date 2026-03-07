import { json } from '@sveltejs/kit';
import { getOnlineUserIds } from '$lib/server/ws';
import type { RequestHandler } from './$types';

/**
 * GET /api/admin/users/online
 * Returns set of currently online user IDs.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const onlineIds = [...getOnlineUserIds()];
	return json({ userIds: onlineIds, count: onlineIds.length });
};
