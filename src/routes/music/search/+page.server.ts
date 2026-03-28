import type { PageServerLoad } from './$types';
import { getMusicSongs, getMusicAlbums, getMusicArtists, getUserPlaylists } from '$lib/server/music';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user?.id;
	const query = url.searchParams.get('q') ?? '';
	if (!userId || !query) return { query, songs: [] as any[], albums: [] as any[], artists: [] as any[], playlists: [] as any[] };

	const [songsResult, albumsResult, artistsResult, allPlaylists] = await Promise.all([
		getMusicSongs(userId, { search: query, limit: 10 }),
		getMusicAlbums(userId, { sort: 'added', limit: 50 }),
		getMusicArtists(userId, { sort: 'SortName', limit: 50 }),
		getUserPlaylists(userId)
	]);

	const songs = songsResult.items ?? [];

	// Client-side filter albums and artists by query (since adapters may not support search)
	const q = query.toLowerCase();
	const albums = (albumsResult.items ?? albumsResult)
		.filter(
			(a: any) =>
				a.title?.toLowerCase().includes(q) ||
				((a.metadata?.artist as string) ?? '').toLowerCase().includes(q)
		)
		.slice(0, 10);

	const artists = (artistsResult.items ?? artistsResult)
		.filter((a: any) => (a.name ?? a.title ?? '').toLowerCase().includes(q))
		.slice(0, 10);

	const playlists = allPlaylists.filter((p: any) => p.name.toLowerCase().includes(q));

	return { query, songs, albums, artists, playlists };
};
