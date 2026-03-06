import { json } from '@sveltejs/kit';
import { getActiveSessionForMedia } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET /api/media/:id/session?serviceId=X — active sessions for a media item
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) return json({ error: 'Missing serviceId' }, { status: 400 });

	const sessions = getActiveSessionForMedia(params.id, serviceId);
	return json({ sessions });
};
