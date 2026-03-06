import { json, error } from '@sveltejs/kit';
import { addTrackToPlaylist, removeTrackFromPlaylist } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401);
	const { trackId, serviceId } = await request.json();
	if (!trackId || !serviceId) throw error(400, 'trackId and serviceId required');
	const id = addTrackToPlaylist(params.id, locals.user.id, trackId, serviceId);
	if (!id) throw error(404, 'Playlist not found');
	return json({ id });
};

export const DELETE: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401);
	const trackId = url.searchParams.get('trackId');
	if (!trackId) throw error(400, 'trackId required');
	const ok = removeTrackFromPlaylist(params.id, locals.user.id, trackId);
	if (!ok) throw error(404);
	return json({ ok: true });
};
