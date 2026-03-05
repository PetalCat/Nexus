import { unifiedSearch } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	const typeFilter = url.searchParams.get('type')?.trim() || undefined;

	if (query.length < 2) {
		return { query, typeFilter, items: [], total: 0 };
	}

	let items = await unifiedSearch(query, locals.user?.id);
	if (typeFilter) {
		items = items.filter((item) => item.type === typeFilter);
	}
	return { query, typeFilter, items, total: items.length };
};
