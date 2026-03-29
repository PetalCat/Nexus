import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

// GET /api/collections — list all collections from all adapters
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const collections = await withCache('collections:all', 1_800_000, async () => {
		const configs = getEnabledConfigs();
		const all: any[] = [];

		await Promise.allSettled(
			configs.map(async (config) => {
				const adapter = registry.get(config.type);
				if (!adapter?.getSubItems) return;
				try {
					const res = await adapter.getSubItems(config, '', 'collection', {});
					all.push(...(res?.items ?? []));
				} catch {}
			})
		);

		return all.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
	});

	return json(collections);
};
