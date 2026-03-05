import { json, error } from '@sveltejs/kit';
import { getUserFavorites, addUserFavorite, removeUserFavorite, reorderUserFavorites } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET: List user's favorites
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const userId = url.searchParams.get('userId') ?? locals.user.id;
	const favorites = getUserFavorites(userId);
	return json(favorites);
};

// POST: Add a favorite
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);
	const { mediaId, serviceId, mediaType, mediaTitle, mediaPoster } = await request.json();
	if (!mediaId || !serviceId || !mediaType || !mediaTitle) {
		throw error(400, 'mediaId, serviceId, mediaType, mediaTitle required');
	}
	const id = addUserFavorite(locals.user.id, { mediaId, serviceId, mediaType, mediaTitle, mediaPoster });
	return json({ id });
};

// DELETE: Remove a favorite
export const DELETE: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'id required');
	const ok = removeUserFavorite(locals.user.id, id);
	if (!ok) throw error(404, 'Favorite not found');
	return json({ ok: true });
};

// PUT: Reorder favorites
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);
	const { orderedIds } = await request.json();
	if (!Array.isArray(orderedIds)) throw error(400, 'orderedIds array required');
	reorderUserFavorites(locals.user.id, orderedIds);
	return json({ ok: true });
};
