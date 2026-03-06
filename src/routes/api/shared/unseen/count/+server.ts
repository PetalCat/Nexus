import { json } from '@sveltejs/kit';
import { getUnseenShareCount } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET /api/shared/unseen/count — badge count
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const count = getUnseenShareCount(locals.user.id);
	return json({ count });
};
