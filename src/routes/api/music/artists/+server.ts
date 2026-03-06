import { json, error } from '@sveltejs/kit';
import { getMusicArtists } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const sort = url.searchParams.get('sort') ?? undefined;
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const offset = Number(url.searchParams.get('offset') ?? 0);
	const serviceId = url.searchParams.get('serviceId') ?? undefined;
	const result = await getMusicArtists(locals.user.id, { sort, limit, offset, serviceId });
	return json(result);
};
