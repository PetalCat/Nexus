import type { PageServerLoad } from './$types';
import { getMissingCategories } from '$lib/server/onboarding';

export const load: PageServerLoad = async ({ fetch, url, locals }) => {
	const category = url.searchParams.get('category') ?? 'trending';
	const genreId = url.searchParams.get('genreId') ?? '';

	const [discoverRes, movieGenresRes, tvGenresRes] = await Promise.all([
		fetch(`/api/discover?category=${category}&genreId=${genreId}&page=1`),
		fetch('/api/discover/genres?type=movie'),
		fetch('/api/discover/genres?type=tv')
	]);

	const discover = discoverRes.ok ? await discoverRes.json() : { items: [], hasMore: false };
	const movieGenres = movieGenresRes.ok ? await movieGenresRes.json() : [];
	const tvGenres = tvGenresRes.ok ? await tvGenresRes.json() : [];

	return { discover, movieGenres, tvGenres, category, genreId, missingCategories: locals.user?.isAdmin ? getMissingCategories(['requests']) : [] };
};
