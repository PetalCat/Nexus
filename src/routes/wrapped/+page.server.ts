import type { PageServerLoad } from './$types';
import { computeWrapped } from '$lib/server/wrapped';

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.user) return { wrapped: null, year: new Date().getFullYear() };
	const year = parseInt(url.searchParams.get('year') ?? String(new Date().getFullYear()), 10);
	const wrapped = computeWrapped(locals.user.id, year);
	return { wrapped, year };
};
