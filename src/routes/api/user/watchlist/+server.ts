import { json, error } from '@sveltejs/kit';
import { getUserWatchlist, addToWatchlist, removeFromWatchlist, reorderWatchlist } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET: List user's watchlist
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const userId = url.searchParams.get('userId') ?? locals.user.id;
	const items = getUserWatchlist(userId);
	return json(items);
};

// POST: Add to watchlist
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);
	const { mediaId, serviceId, mediaType, mediaTitle, mediaPoster } = await request.json();
	if (!mediaId || !serviceId || !mediaType || !mediaTitle) {
		throw error(400, 'mediaId, serviceId, mediaType, mediaTitle required');
	}
	const id = addToWatchlist(locals.user.id, { mediaId, serviceId, mediaType, mediaTitle, mediaPoster });
	return json({ id });
};

// DELETE: Remove from watchlist
export const DELETE: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'id required');
	const ok = removeFromWatchlist(locals.user.id, id);
	if (!ok) throw error(404, 'Watchlist item not found');
	return json({ ok: true });
};

// PUT: Reorder watchlist
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);
	const { orderedIds } = await request.json();
	if (!Array.isArray(orderedIds)) throw error(400, 'orderedIds array required');
	reorderWatchlist(locals.user.id, orderedIds);
	return json({ ok: true });
};
