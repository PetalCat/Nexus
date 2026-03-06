import { json, error } from '@sveltejs/kit';
import { getPlaylist, updatePlaylist, deletePlaylist } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const playlist = getPlaylist(params.id, locals.user.id);
	if (!playlist) throw error(404);
	return json(playlist);
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401);
	const { name, description } = await request.json();
	const ok = updatePlaylist(params.id, locals.user.id, { name, description });
	if (!ok) throw error(404);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const ok = deletePlaylist(params.id, locals.user.id);
	if (!ok) throw error(404);
	return json({ ok: true });
};
