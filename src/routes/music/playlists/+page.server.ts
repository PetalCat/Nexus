import type { PageServerLoad } from './$types';
import { getUserPlaylists, getLikedTracks } from '$lib/server/music';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	if (!userId) return { playlists: [], likedCount: 0 };

	const [playlists, liked] = await Promise.all([
		getUserPlaylists(userId),
		getLikedTracks(userId)
	]);

	return { playlists, likedCount: liked.length };
};
