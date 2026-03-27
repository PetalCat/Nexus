import { getSharedItems } from '$lib/server/social';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { items: [] };
	const items = getSharedItems(locals.user.id, { limit: 50 });
	return { items };
};
