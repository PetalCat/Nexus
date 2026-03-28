import type { PageServerLoad } from './$types';
import { getMusicAlbums, getMusicArtists, getRecentlyPlayed, getJellyfinMusicConfigs } from '$lib/server/music';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	if (!userId) return { recentlyPlayed: [], newAlbums: [], artists: [], serviceUrls: {} };

	const configs = getJellyfinMusicConfigs();
	const serviceUrls: Record<string, string> = {};
	for (const c of configs) serviceUrls[c.id] = c.url;

	const [recentlyPlayed, albumsResult, artistsResult] = await Promise.all([
		getRecentlyPlayed(userId, 20),
		getMusicAlbums(userId, { sort: 'added', limit: 20 }),
		getMusicArtists(userId, { sort: 'SortName', limit: 20 })
	]);

	return {
		recentlyPlayed,
		newAlbums: albumsResult.items ?? albumsResult,
		artists: artistsResult.items ?? artistsResult,
		serviceUrls
	};
};
