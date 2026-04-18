import type { PageServerLoad } from './$types';
import { getMusicAlbums, getMusicArtists, getRecentlyPlayed, getJellyfinMusicConfigs } from '$lib/server/music';
import { resolveHistoryPoster } from '$lib/server/history-thumbnails';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	if (!userId) return { recentlyPlayed: [], newAlbums: [], artists: [], serviceUrls: {} };

	const configs = getJellyfinMusicConfigs();
	const serviceUrls: Record<string, string> = {};
	for (const c of configs) serviceUrls[c.id] = c.url;

	const [rawRecentlyPlayed, albumsResult, artistsResult] = await Promise.all([
		getRecentlyPlayed(userId, 20),
		getMusicAlbums(userId, { sort: 'added', limit: 20 }),
		getMusicArtists(userId, { sort: 'SortName', limit: 20 })
	]);

	// Resolve per-service poster URLs server-side (matches A10 history pattern)
	// so the client doesn't hardcode Jellyfin /Items/.../Primary assumptions.
	const recentlyPlayed = rawRecentlyPlayed.map((item) => ({
		...item,
		poster: resolveHistoryPoster({
			serviceId: item.serviceId,
			serviceType: item.serviceType,
			mediaId: item.mediaId,
			mediaType: 'music',
			serviceUrl: serviceUrls[item.serviceId]
		})
	}));

	return {
		recentlyPlayed,
		newAlbums: albumsResult.items ?? albumsResult,
		artists: artistsResult.items ?? artistsResult,
		serviceUrls
	};
};
