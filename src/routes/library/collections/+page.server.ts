import { getUserCollections } from '$lib/server/social';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { owned: [], joined: [] };

	const all = getUserCollections(locals.user.id);
	const owned = all.filter((c) => c.userRole === 'owner');
	const joined = all.filter((c) => c.userRole !== 'owner');

	return { owned, joined };
};
