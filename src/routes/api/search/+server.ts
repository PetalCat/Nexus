import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { registryV2 } from '$lib/adapters/v2';
import { resolveServiceConfig } from '$lib/server/v2-services';
import type { UnifiedMedia } from '$lib/adapters/types';

/**
 * GET /api/search?q=… — unified search across every searchable, CONFIGURED backend.
 *
 * Each adapter's `search()` is real backend code (e.g. Jellyfin `/Items?SearchTerm=`),
 * run in parallel and merged. Adapters that declare search but have no resolvable
 * config in this deployment (e.g. Plex in phase-0) are skipped, and one backend
 * failing never sinks the others (Promise.allSettled) — so the route degrades
 * gracefully to whatever is actually wired. No facade: if nothing is searchable,
 * it returns an empty result, not fake data.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const q = (url.searchParams.get('q') ?? '').trim();
	// Sub-2-char queries are noise (every title matches) — don't hammer backends.
	if (q.length < 2) return json({ query: q, results: [] });

	const searchable = registryV2.searchable().filter((a) => typeof a.search === 'function');

	const settled = await Promise.allSettled(
		searchable.map(async (adapter): Promise<UnifiedMedia[]> => {
			const config = resolveServiceConfig(adapter.id);
			if (!config) return [];
			const res = await adapter.search!(config, q);
			return res.items ?? [];
		})
	);

	// Return the raw candidate pool from each backend. RANKING happens client-side
	// with the real nucleo (fzf-grade) matcher — Jellyfin's SearchTerm order is
	// poor (mid-word fuzzy beats exact prefix), and nucleo scores prefix/word-
	// boundary correctly. The server just gathers candidates; the browser orders.
	const results = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));

	return json({ query: q, results });
};
