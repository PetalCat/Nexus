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
	const hasLibraryService = getConfigsForMediaType('show').length > 0;

	const {
		items: libraryItems,
		total,
		pageSize
	} = await browseLibrary({
		type: 'show',
		page,
		pageSize: PAGE_SIZE,
		sortBy,
		q,
		userId
	});

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

	async function fetchPopularTV(): Promise<UnifiedMedia[]> {
		if (requestConfigs.length === 0) return [];
		return withCache('shows:popular', 120_000, async () => {
			const items: UnifiedMedia[] = [];
			await Promise.allSettled(
				requestConfigs.map(async (c) => {
					const adapter = registry.get(c.type);
					if (!adapter?.discover) return;
					const cred = userId ? getUserCredentialForService(userId, c.id) ?? undefined : undefined;
					const result = await adapter.discover(c, { page: 1, category: 'tv' }, cred);
					items.push(...result.items);
				})
			);
			return dedup(items).slice(0, 20);
		});
	}

	async function fetchTrendingTV(): Promise<UnifiedMedia[]> {
		if (requestConfigs.length === 0) return [];
		return withCache('shows:trending', 120_000, async () => {
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
			return dedup(items).filter((i) => i.type === 'show').slice(0, 20);
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
		popularTV: fetchPopularTV(),
		trendingTV: fetchTrendingTV()
	};
};
