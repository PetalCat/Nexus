import { json, error } from '@sveltejs/kit';
import { getUserWatchlist, addToWatchlist, removeFromWatchlist, reorderWatchlist } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET: List user's watchlist. Always scoped to the authenticated caller —
// there is no legitimate non-admin cross-user read, so the `?userId=` param
// was removed (was an IDOR: any logged-in user could read any other user's
// watchlist). Admin tooling should go through a separate admin-guarded route.
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const items = getUserWatchlist(locals.user.id);
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
