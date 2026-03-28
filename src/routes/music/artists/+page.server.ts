import type { PageServerLoad } from './$types';
import { getMusicArtists } from '$lib/server/music';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user?.id;
	if (!userId) return { artists: [], currentSort: 'SortName', search: '' };

	const sort = url.searchParams.get('sort') ?? 'SortName';
	const search = url.searchParams.get('q') ?? '';

	const result = await getMusicArtists(userId, { sort, limit: 200 });

	let artists = result.items ?? result;
	if (search) {
		const q = search.toLowerCase();
		artists = artists.filter((a: any) => (a.name ?? a.title ?? '').toLowerCase().includes(q));
	}

	return { artists, currentSort: sort, search };
};
