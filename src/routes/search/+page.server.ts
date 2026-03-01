import { unifiedSearch } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';

	if (query.length < 2) {
		return { query, items: [], total: 0 };
	}

	const items = await unifiedSearch(query);
	return { query, items, total: items.length };
};
