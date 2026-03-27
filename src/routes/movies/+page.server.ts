import { getEnabledConfigs, getLibraryItems } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';
import type { UnifiedMedia } from '$lib/adapters/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const sortBy = url.searchParams.get('sort') || 'title';
	const userId = locals.user?.id;
	const hasLibraryService = getEnabledConfigs().some((c) => c.type === 'jellyfin');

	// Fast: library movies (Jellyfin, local network) — await immediately
	const { items: libraryItems, total } = await getLibraryItems(
		{ type: 'movie', sortBy, limit: 200 },
		userId
	);

	// Slow: Overseerr popular + trending — stream as deferred promises
	const overseerrConfigs = getEnabledConfigs().filter((c) => c.type === 'overseerr');
	const hasOverseerr = overseerrConfigs.length > 0;
	const adapter = hasOverseerr ? registry.get('overseerr') : undefined;

	function dedup(items: UnifiedMedia[]): UnifiedMedia[] {
		const seen = new Set<string>();
		return items.filter((i) => {
			if (seen.has(i.sourceId)) return false;
			seen.add(i.sourceId);
			return true;
		});
	}

	async function fetchPopular(): Promise<UnifiedMedia[]> {
		if (!adapter?.discover) return [];
		return withCache('movies:popular', 120_000, async () => {
			const items: UnifiedMedia[] = [];
			await Promise.allSettled(
				overseerrConfigs.map(async (c) => {
					const cred = userId ? getUserCredentialForService(userId, c.id) ?? undefined : undefined;
					const result = await adapter.discover!(c, { page: 1, category: 'movies' }, cred);
					items.push(...result.items);
				})
			);
			return dedup(items).slice(0, 20);
		});
	}

	async function fetchTrending(): Promise<UnifiedMedia[]> {
		if (!adapter?.discover) return [];
		return withCache('movies:trending', 120_000, async () => {
			const items: UnifiedMedia[] = [];
			await Promise.allSettled(
				overseerrConfigs.map(async (c) => {
					const cred = userId ? getUserCredentialForService(userId, c.id) ?? undefined : undefined;
					const result = await adapter.discover!(c, { page: 1, category: 'trending' }, cred);
					items.push(...result.items);
				})
			);
			return dedup(items).filter((i) => i.type === 'movie').slice(0, 20);
		});
	}

	return {
		libraryItems,
		total,
		sortBy,
		hasLibraryService,
		hasOverseerr,
		// Streamed — page renders immediately, these fill in when ready
		popularMovies: fetchPopular(),
		trendingMovies: fetchTrending()
	};
};
