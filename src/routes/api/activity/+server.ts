import { json } from '@sveltejs/kit';
import { getFriendActivity } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET /api/activity?limit=50&offset=0&mediaId=X&serviceId=Y
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const limit = parseInt(url.searchParams.get('limit') ?? '50');
	const offset = parseInt(url.searchParams.get('offset') ?? '0');
	const mediaId = url.searchParams.get('mediaId') ?? undefined;
	const serviceId = url.searchParams.get('serviceId') ?? undefined;

	const activity = getFriendActivity(locals.user.id, { limit, offset, mediaId, serviceId });
	return json({ activity });
};
