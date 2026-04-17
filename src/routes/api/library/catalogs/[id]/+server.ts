import { json, error } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

// GET /api/library/catalogs/:id — single adapter-sourced catalog detail
// (renamed 2026-04-17 from /api/collections/:id).
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const collection = await withCache(`collection:${params.id}`, 1_800_000, async () => {
		const configs = getEnabledConfigs();

		for (const config of configs) {
			const adapter = registry.get(config.type);
			if (!adapter?.getSubItems) continue;
			try {
				const res = await adapter.getSubItems(config, params.id, 'collection', {});
				if (res && res.items.length > 0) return res;
			} catch {}
		}
		return null;
	});

	if (!collection) throw error(404, 'Collection not found');
	return json(collection);
};
