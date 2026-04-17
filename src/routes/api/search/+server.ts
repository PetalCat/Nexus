import { json } from '@sveltejs/kit';
import { unifiedSearch, type SearchScope } from '$lib/server/search';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

const VALID_SCOPES: SearchScope[] = ['all', 'library', 'discover', 'requestable', 'video'];

function parseScope(raw: string | null): SearchScope {
	// Back-compat: `source=library|discover` still works alongside `scope=…`.
	if (!raw) return 'all';
	return (VALID_SCOPES as string[]).includes(raw) ? (raw as SearchScope) : 'all';
}

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const query = url.searchParams.get('q')?.trim();
	const typeFilter = url.searchParams.get('type')?.trim() || undefined;
	const scope = parseScope(url.searchParams.get('scope') ?? url.searchParams.get('source'));

	if (!query || query.length < 2) {
		return json({ items: [] });
	}

	try {
		const cacheKey = `search:${query.toLowerCase()}:${scope}:${typeFilter ?? '*'}`;
		// Library searches are fast — shorter cache. Discovery can be longer.
		const ttl = scope === 'library' ? 30_000 : 60_000;
		const items = await withCache(cacheKey, ttl, () =>
			unifiedSearch({ query, userId: locals.user?.id, scope, type: typeFilter })
		);
		return json({ items, total: items.length });
	} catch (e) {
		console.error('[API] search error', e);
		return json({ error: 'Search failed' }, { status: 500 });
	}
};
