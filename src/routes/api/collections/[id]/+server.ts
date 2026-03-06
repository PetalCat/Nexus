import { json } from '@sveltejs/kit';
import { getCollection, updateCollection, deleteCollection } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET /api/collections/:id — collection detail + items
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const collection = getCollection(params.id, locals.user.id);
	if (!collection) return json({ error: 'Not found' }, { status: 404 });

	return json({ collection });
};

// PUT /api/collections/:id — update name/description/visibility
// Body: { name?, description?, visibility? }
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { name, description, visibility } = body;

	const ok = updateCollection(params.id, locals.user.id, { name, description, visibility });
	if (!ok) return json({ error: 'Not found or no permission' }, { status: 403 });

	return json({ ok: true });
};

// DELETE /api/collections/:id — delete (creator only)
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const ok = deleteCollection(params.id, locals.user.id);
	if (!ok) return json({ error: 'Not found or not creator' }, { status: 403 });

	return json({ ok: true });
};
