import { json, error } from '@sveltejs/kit';
import { getUserPlaylists, createPlaylist } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const playlists = getUserPlaylists(locals.user.id);
	return json(playlists);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);
	const { name, description } = await request.json();
	if (!name) throw error(400, 'name required');
	const id = createPlaylist(locals.user.id, name, description);
	return json({ id });
};
