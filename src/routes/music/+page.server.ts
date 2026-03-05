import { getLibraryItems } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const sortBy = url.searchParams.get('sort') || 'title';
	const { items, total } = await getLibraryItems({ type: 'music', sortBy, limit: 200 }, locals.user?.id);
	return { items, total, sortBy };
};
