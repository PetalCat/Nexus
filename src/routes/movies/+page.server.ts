import { browseLibrary, getConfigsForMediaType, getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';
import type { UnifiedMedia } from '$lib/adapters/types';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 48;

export const load: PageServerLoad = async ({ url, locals }) => {
	const sortBy = url.searchParams.get('sort') || 'title';
	const q = url.searchParams.get('q')?.trim() ?? '';
	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	const userId = locals.user?.id;
	const hasLibraryService = getConfigsForMediaType('movie').length > 0;

	// Fast: library movies (server-side paginated) — await immediately
	const {
		items: libraryItems,
		total,
		pageSize
	} = await browseLibrary({
		type: 'movie',
		page,
		pageSize: PAGE_SIZE,
		sortBy,
		q,
		userId
	});

	// Slow: request-provider popular + trending — stream as deferred promises.
	// Any adapter that implements getRequests is treated as a request provider
	// (Overseerr, Jellyseerr, …) — no hardcoded `registry.get('overseerr')`.
	const requestConfigs = getEnabledConfigs().filter(
		(c) => !!registry.get(c.type)?.getRequests
	);
	const hasOverseerr = requestConfigs.length > 0;

	function dedup(items: UnifiedMedia[]): UnifiedMedia[] {
		const seen = new Set<string>();
		return items.filter((i) => {
			if (seen.has(i.sourceId)) return false;
			seen.add(i.sourceId);
			return true;
		});
	}

	async function fetchPopular(): Promise<UnifiedMedia[]> {
		if (requestConfigs.length === 0) return [];
		return withCache('movies:popular', 120_000, async () => {
			const items: UnifiedMedia[] = [];
			await Promise.allSettled(
				requestConfigs.map(async (c) => {
					const adapter = registry.get(c.type);
					if (!adapter?.discover) return;
					const cred = userId ? getUserCredentialForService(userId, c.id) ?? undefined : undefined;
					const result = await adapter.discover(c, { page: 1, category: 'movies' }, cred);
					items.push(...result.items);
				})
			);
			return dedup(items).slice(0, 20);
		});
	}

	async function fetchTrending(): Promise<UnifiedMedia[]> {
		if (requestConfigs.length === 0) return [];
		return withCache('movies:trending', 120_000, async () => {
			const items: UnifiedMedia[] = [];
			await Promise.allSettled(
				requestConfigs.map(async (c) => {
					const adapter = registry.get(c.type);
					if (!adapter?.discover) return;
					const cred = userId ? getUserCredentialForService(userId, c.id) ?? undefined : undefined;
					const result = await adapter.discover(c, { page: 1, category: 'trending' }, cred);
					items.push(...result.items);
				})
			);
			return dedup(items).filter((i) => i.type === 'movie').slice(0, 20);
		});
	}

	return {
		libraryItems,
		total,
		page,
		pageSize,
		q,
		sortBy,
		hasLibraryService,
		hasOverseerr,
		// Streamed — page renders immediately, these fill in when ready
		popularMovies: fetchPopular(),
		trendingMovies: fetchTrending()
	};
};
