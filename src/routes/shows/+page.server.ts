import { getConfigsForMediaType, getLibraryItems, getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';
import type { UnifiedMedia } from '$lib/adapters/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const sortBy = url.searchParams.get('sort') || 'title';
	const userId = locals.user?.id;
	const hasLibraryService = getConfigsForMediaType('show').length > 0;

	// Library shows from media servers (Jellyfin, etc.)
	const { items: libraryItems, total } = await getLibraryItems(
		{ type: 'show', sortBy, limit: 200 },
		userId
	);

	// Overseerr popular + trending TV (cached 2 min)
	const overseerrConfigs = getEnabledConfigs().filter((c) => {
		const adapter = registry.get(c.type);
		return !!adapter?.getRequests;
	});
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

	async function fetchPopularTV(): Promise<UnifiedMedia[]> {
		if (!adapter?.discover) return [];
		return withCache('shows:popular', 120_000, async () => {
			const items: UnifiedMedia[] = [];
			await Promise.allSettled(
				overseerrConfigs.map(async (c) => {
					const cred = userId ? getUserCredentialForService(userId, c.id) ?? undefined : undefined;
					const result = await adapter.discover!(c, { page: 1, category: 'tv' }, cred);
					items.push(...result.items);
				})
			);
			return dedup(items).slice(0, 20);
		});
	}

	async function fetchTrendingTV(): Promise<UnifiedMedia[]> {
		if (!adapter?.discover) return [];
		return withCache('shows:trending', 120_000, async () => {
			const items: UnifiedMedia[] = [];
			await Promise.allSettled(
				overseerrConfigs.map(async (c) => {
					const cred = userId ? getUserCredentialForService(userId, c.id) ?? undefined : undefined;
					const result = await adapter.discover!(c, { page: 1, category: 'trending' }, cred);
					items.push(...result.items);
				})
			);
			return dedup(items).filter((i) => i.type === 'show').slice(0, 20);
		});
	}

	return {
		libraryItems,
		total,
		sortBy,
		hasLibraryService,
		hasOverseerr,
		// Streamed — page renders immediately with library, these fill in
		popularTV: fetchPopularTV(),
		trendingTV: fetchTrendingTV()
	};
};
