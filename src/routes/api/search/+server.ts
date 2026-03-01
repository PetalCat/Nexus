import { json } from '@sveltejs/kit';
import { unifiedSearch } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim();
	if (!query || query.length < 2) {
		return json({ items: [] });
	}
	try {
		const items = await unifiedSearch(query);
		return json({ items, total: items.length });
	} catch (e) {
		console.error('[API] search error', e);
		return json({ error: 'Search failed' }, { status: 500 });
	}
};
