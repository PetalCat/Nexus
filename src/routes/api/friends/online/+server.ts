import { json } from '@sveltejs/kit';
import { getOnlineFriends } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET /api/friends/online — online/away friends only
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const friends = getOnlineFriends(locals.user.id);
	return json({ friends });
};
