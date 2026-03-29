import type { PageServerLoad } from './$types';
import { getFranchiseData } from '$lib/server/franchise';

export const load: PageServerLoad = async ({ url, locals }) => {
	const name = url.searchParams.get('name') ?? '';
	if (!name || !locals.user) return { franchise: null, name: '' };
	const franchise = await getFranchiseData(name, locals.user.id);
	return { franchise, name };
};
