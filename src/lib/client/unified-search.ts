/**
 * Client-side unified search helper. Three consumers:
 *   • CommandPalette.svelte — { scope: 'library' } + { scope: 'discover' }
 *   • /search page (if ever client-driven)
 *   • /requests page — { scope: 'requestable' }
 *
 * Scope parity with `$lib/server/search`:
 *   'all'         — every searchable adapter
 *   'library'     — library-type adapters only
 *   'discover'    — non-library adapters
 *   'requestable' — discover filtered to request-provider adapters
 *   'video'       — routes to /api/video/search (Invidious etc.)
 */
import type { UnifiedMedia } from '$lib/adapters/types';

export type SearchScope = 'all' | 'library' | 'discover' | 'requestable' | 'video';

export interface UnifiedSearchOpts {
	query: string;
	scope?: SearchScope;
	type?: 'movie' | 'show' | 'book' | 'game' | 'music' | 'video' | 'live';
	signal?: AbortSignal;
}

export async function unifiedSearch(opts: UnifiedSearchOpts): Promise<UnifiedMedia[]> {
	const { query, scope = 'all', type, signal } = opts;
	if (!query || query.trim().length < 2) return [];

	// Video scope has its own provider-specific endpoint.
	if (scope === 'video') {
		const res = await fetch(`/api/video/search?q=${encodeURIComponent(query.trim())}`, { signal });
		if (!res.ok) return [];
		const data = await res.json();
		return (data.items ?? []) as UnifiedMedia[];
	}

	const params = new URLSearchParams({ q: query.trim(), scope });
	if (type) params.set('type', type);

	const res = await fetch(`/api/search?${params}`, { signal });
	if (!res.ok) return [];
	const data = await res.json();
	return (data.items ?? []) as UnifiedMedia[];
}
