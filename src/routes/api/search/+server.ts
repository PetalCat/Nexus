import { json } from '@sveltejs/kit';
import { unifiedSearch } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const query = url.searchParams.get('q')?.trim();
	const typeFilter = url.searchParams.get('type')?.trim() || undefined;
	const source = url.searchParams.get('source') as 'library' | 'discover' | null;
	if (!query || query.length < 2) {
		return json({ items: [] });
	}
	try {
		const srcTag = source ? `:${source}` : '';
		const cacheKey = typeFilter
			? `search:${query.toLowerCase()}:${typeFilter}${srcTag}`
			: `search:${query.toLowerCase()}${srcTag}`;
		// Library searches are fast — shorter cache. Discovery can be longer.
		const ttl = source === 'library' ? 30_000 : 60_000;
		let items = await withCache(cacheKey, ttl, () =>
			unifiedSearch(query, locals.user?.id, source ?? undefined)
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
