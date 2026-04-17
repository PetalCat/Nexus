import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	const res = await fetch('/api/library/catalogs');
	const collections = res.ok ? await res.json() : [];
	return { collections };
};
