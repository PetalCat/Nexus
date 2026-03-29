import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import type { UnifiedMedia } from '$lib/adapters/types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const category = url.searchParams.get('type') ?? undefined;
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ items: [] });
	const config = configs[0];
	const adapter = registry.get(config.type);
	let items = (await adapter?.getServiceData?.(config, 'trending-by-category', { category }) ?? []) as UnifiedMedia[];

	// Apply DeArrow enrichment if available
	if (adapter?.enrichItem) {
		items = await Promise.all(
			items.map(item => adapter.enrichItem!(config, item, 'dearrow'))
		);
	}

	return json({ items });
};
