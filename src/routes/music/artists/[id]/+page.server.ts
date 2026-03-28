import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getMusicArtistDetail, getArtistTopSongs } from '$lib/server/music';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const userId = locals.user?.id;
	if (!userId) throw error(401);
	const serviceId = url.searchParams.get('service') ?? '';

	const [artistDetail, topSongs] = await Promise.all([
		getMusicArtistDetail(userId, params.id, serviceId),
		getArtistTopSongs(userId, params.id, serviceId, 5)
	]);

	if (!artistDetail) throw error(404, 'Artist not found');

	return {
		artist: artistDetail.artist,
		albums: artistDetail.albums ?? [],
		topSongs,
		serviceId
	};
};
