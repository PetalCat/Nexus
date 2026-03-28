import type { PageServerLoad } from './$types';
import { getMusicAlbums } from '$lib/server/music';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user?.id;
	if (!userId) return { albums: [], genres: [], currentGenre: '', currentSort: 'added', search: '' };

	const genre = url.searchParams.get('genre') ?? '';
	const sort = url.searchParams.get('sort') ?? 'added';
	const search = url.searchParams.get('q') ?? '';

	const result = await getMusicAlbums(userId, { genre: genre || undefined, sort: sort || 'added', limit: 200 });

	let albums = result.items ?? result;
	if (search) {
		const q = search.toLowerCase();
		albums = albums.filter((a: any) => a.title?.toLowerCase().includes(q) || (a.metadata?.artist as string ?? '').toLowerCase().includes(q));
	}

	const genres = [...new Set(albums.flatMap((a: any) => a.genres ?? []))].sort();
	return { albums, genres, currentGenre: genre, currentSort: sort, search };
};
