import { json, error } from '@sveltejs/kit';
import { getLikedTracks, likeTrack, unlikeTrack } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const tracks = getLikedTracks(locals.user.id);
	return json(tracks);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);
	const { trackId, serviceId } = await request.json();
	if (!trackId || !serviceId) throw error(400, 'trackId and serviceId required');
	const id = likeTrack(locals.user.id, trackId, serviceId);
	return json({ id });
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const trackId = url.searchParams.get('trackId');
	const serviceId = url.searchParams.get('serviceId');
	if (!trackId || !serviceId) throw error(400, 'trackId and serviceId required');
	const ok = unlikeTrack(locals.user.id, trackId, serviceId);
	if (!ok) throw error(404);
	return json({ ok: true });
};
