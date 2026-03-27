import { getUserWatchlist } from '$lib/server/social';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) return { items: [], filterType: 'all', sortBy: 'added' };

	const items = getUserWatchlist(locals.user.id);
	const filterType = url.searchParams.get('type') ?? 'all';
	const sortBy = url.searchParams.get('sort') ?? 'added';

	return { items, filterType, sortBy };
};
