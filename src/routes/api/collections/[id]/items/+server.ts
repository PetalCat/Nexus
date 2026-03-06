import { json } from '@sveltejs/kit';
import { addCollectionItem } from '$lib/server/social';
import type { RequestHandler } from './$types';

// POST /api/collections/:id/items — add media to collection
// Body: { mediaId, serviceId, mediaType, mediaTitle, mediaPoster? }
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { mediaId, serviceId, mediaType, mediaTitle, mediaPoster } = body;

	if (!mediaId || !serviceId || !mediaType || !mediaTitle) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}

	const itemId = addCollectionItem(params.id, locals.user.id, {
		mediaId, serviceId, mediaType, mediaTitle, mediaPoster
	});

	if (!itemId) return json({ error: 'No permission or collection not found' }, { status: 403 });

	return json({ id: itemId });
};
