import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { withCache } from '$lib/server/cache';
import type { UnifiedMedia } from '$lib/adapters/types';
import type { RequestHandler } from './$types';

// GET /api/discover?page=1&category=trending|movies|tv
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
	const category = (url.searchParams.get('category') ?? 'trending') as 'trending' | 'movies' | 'tv';
	const userId = locals.user.id;

	const result = await withCache(`discover:${category}:${page}:${userId}`, 120_000, async () => {
		const configs = getEnabledConfigs().filter((c) => c.type === 'overseerr');
		const allItems: UnifiedMedia[] = [];
		let hasMore = false;

		await Promise.allSettled(
			configs.map(async (config) => {
				const adapter = registry.get('overseerr');
				if (!adapter?.discover) return;
				const cred = getUserCredentialForService(userId, config.id) ?? undefined;
				const res = await adapter.discover(config, { page, category }, cred);
				allItems.push(...res.items);
				if (res.hasMore) hasMore = true;
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
