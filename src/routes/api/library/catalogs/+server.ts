import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

// GET /api/library/catalogs — list all adapter-sourced "catalogs"
// (Jellyfin BoxSets, Plex collections, RomM collections, etc.). Renamed
// 2026-04-17 from /api/collections to disambiguate from the user/social
// collections at /library/collections + /api/collections/[id]/items.
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
