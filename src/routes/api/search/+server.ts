import { json } from '@sveltejs/kit';
import { unifiedSearch } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const query = url.searchParams.get('q')?.trim();
	const typeFilter = url.searchParams.get('type')?.trim() || undefined;
	if (!query || query.length < 2) {
		return json({ items: [] });
	}
	try {
		// Cache search results for 60s — same query is often repeated while typing
		const cacheKey = typeFilter ? `search:${query.toLowerCase()}:${typeFilter}` : `search:${query.toLowerCase()}`;
		let items = await withCache(cacheKey, 60_000, () =>
			unifiedSearch(query, locals.user?.id)
		);
		if (typeFilter) {
			items = items.filter((item: { type: string }) => item.type === typeFilter);
		}
		return json({ items, total: items.length });
	} catch (e) {
		console.error('[API] search error', e);
		return json({ error: 'Search failed' }, { status: 500 });
	}
};
