import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { withCache } from '$lib/server/cache';
import type { UnifiedMedia } from '$lib/adapters/types';
import type { RequestHandler } from './$types';

// GET /api/discover?page=1&category=trending|movies|tv|upcoming-movies|upcoming-tv|popular-movies|popular-tv|genre-movie|genre-tv|network&genreId=28&networkId=213
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
	const category = url.searchParams.get('category') ?? 'trending';
	const genreId = url.searchParams.get('genreId') ?? undefined;
	const networkId = url.searchParams.get('networkId') ?? undefined;
	const userId = locals.user.id;

	const cacheKey = `discover:${category}:${genreId ?? ''}:${networkId ?? ''}:${page}`;

	const result = await withCache(cacheKey, 900_000, async () => {
		const configs = getEnabledConfigs().filter((c) => {
			const adapter = registry.get(c.type);
			return !!adapter?.discover;
		});
		const allItems: UnifiedMedia[] = [];
		let hasMore = false;

		await Promise.allSettled(
			configs.map(async (config) => {
				const adapter = registry.get(config.type);
				if (!adapter?.discover) return;
				const cred = getUserCredentialForService(userId, config.id) ?? undefined;
				const res = await adapter.discover(config, { page, category, genreId, networkId }, cred);
				allItems.push(...(res?.items ?? []));
				if (res?.hasMore) hasMore = true;
			})
		);

		// Deduplicate by sourceId
		const seen = new Set<string>();
		const items = allItems.filter((i) => {
			if (seen.has(i.sourceId)) return false;
			seen.add(i.sourceId);
			return true;
		});

		return { items, hasMore, page };
	});

	return json(result);
};
