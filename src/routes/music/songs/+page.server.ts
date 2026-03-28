import type { PageServerLoad } from './$types';
import { getMusicSongs } from '$lib/server/music';
import { getLikedTracks } from '$lib/server/music';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user?.id;
	if (!userId) return { songs: [], likedIds: [], currentSort: 'SortName', search: '' };

	const sort = url.searchParams.get('sort') ?? 'SortName';
	const search = url.searchParams.get('q') ?? '';

	const [result, liked] = await Promise.all([
		getMusicSongs(userId, { sort, limit: 200, search: search || undefined }),
		getLikedTracks(userId)
	]);

	const likedIds = liked.map((l) => `${l.trackId}::${l.serviceId}`);

	return { songs: result.items, likedIds, currentSort: sort, search };
};
