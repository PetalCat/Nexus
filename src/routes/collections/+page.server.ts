import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	const res = await fetch('/api/collections');
	const collections = res.ok ? await res.json() : [];
	return { collections };
};
