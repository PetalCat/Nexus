import { json } from '@sveltejs/kit';
import { getMediaFriendActivity } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET /api/media/:id/friends?serviceId=X
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) return json({ error: 'Missing serviceId' }, { status: 400 });

	const result = getMediaFriendActivity(locals.user.id, params.id, serviceId);
	return json(result);
};
