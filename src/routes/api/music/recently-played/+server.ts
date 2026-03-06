import { json, error } from '@sveltejs/kit';
import { getRecentlyPlayed } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const tracks = getRecentlyPlayed(locals.user.id, limit);
	return json(tracks);
};
