import { json } from '@sveltejs/kit';
import { removeCollectionItem } from '$lib/server/social';
import type { RequestHandler } from './$types';

// DELETE /api/collections/:id/items/:itemId — remove media from collection
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const ok = removeCollectionItem(params.id, params.itemId, locals.user.id);
	if (!ok) return json({ error: 'Not found or no permission' }, { status: 403 });

	return json({ ok: true });
};
