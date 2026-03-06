import { json, error } from '@sveltejs/kit';
import { getMusicAlbums } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const genre = url.searchParams.get('genre') ?? undefined;
	const artistId = url.searchParams.get('artistId') ?? undefined;
	const sort = url.searchParams.get('sort') ?? undefined;
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const offset = Number(url.searchParams.get('offset') ?? 0);
	const serviceId = url.searchParams.get('serviceId') ?? undefined;
	const result = await getMusicAlbums(locals.user.id, { genre, artistId, sort, limit, offset, serviceId });
	return json(result);
};
