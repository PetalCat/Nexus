import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, params }) => {
	const res = await fetch(`/api/library/catalogs/${params.id}`);
	if (!res.ok) return { collection: null, movies: [] };
	const data = await res.json();
	return { collection: data, movies: data.items ?? [] };
};
