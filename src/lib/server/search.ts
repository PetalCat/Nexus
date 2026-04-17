/**
 * Unified search surface for the three in-app search consumers:
 * command palette, `/search` page, and `/requests`. Wraps `unifiedSearch`
 * in `services.ts` with scope semantics that match the client helper
 * (`$lib/client/unified-search`).
 *
 * Scopes:
 *   'all'         — search every searchable adapter
 *   'library'     — only library-type adapters (Jellyfin, Calibre, RomM, ...)
 *   'discover'    — only non-library adapters (Overseerr, Lidarr, ...)
 *   'requestable' — discover filtered to adapters that actually implement
 *                   `getRequests` (i.e. a request provider). Avoids the
 *                   hardcoded `serviceType === 'overseerr'` filter.
 *   'video'       — handled client-side (routes to /api/video/search); server
 *                   returns empty here so callers don't crash.
 */
import type { UnifiedMedia } from '$lib/adapters/types';
import { unifiedSearch as legacyUnifiedSearch, getEnabledConfigs } from './services';
import { registry } from '$lib/adapters/registry';

export type SearchScope = 'all' | 'library' | 'discover' | 'requestable' | 'video';

export interface UnifiedSearchServerOpts {
	query: string;
	userId?: string;
	scope?: SearchScope;
	type?: string;
}

/**
 * Server-side unified search. Dispatches to the legacy `unifiedSearch` in
 * `services.ts` under the hood. Splits 'requestable' out into a
 * capability-filtered post-pass (no hardcoded service-type strings).
 */
export async function unifiedSearch(opts: UnifiedSearchServerOpts): Promise<UnifiedMedia[]> {
	const { query, userId, scope = 'all', type } = opts;
	if (!query || query.trim().length < 2) return [];

	if (scope === 'video') return []; // Client handles this via /api/video/search.

	const underlying: 'library' | 'discover' | undefined =
		scope === 'library' ? 'library' : scope === 'discover' || scope === 'requestable' ? 'discover' : undefined;

	let items = await legacyUnifiedSearch(query, userId, underlying);

	if (scope === 'requestable') {
		// A "request provider" = any enabled adapter that implements getRequests.
		// That is the same capability the movies/shows loaders check for popular
		// & trending rows, so the filter stays consistent instead of relying on
		// `serviceType === 'overseerr'` in three unrelated files.
		const requestProviderIds = new Set(
			getEnabledConfigs()
				.filter((c) => !!registry.get(c.type)?.getRequests)
				.map((c) => c.type)
		);
		items = items.filter(
			(i) => requestProviderIds.has(i.serviceType) && i.status !== 'available'
		);
	}

	if (type) {
		items = items.filter((i) => i.type === type);
	}

	return items;
}
