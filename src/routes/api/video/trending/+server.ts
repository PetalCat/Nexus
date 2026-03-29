import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const category = url.searchParams.get('type') ?? undefined;
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ items: [] });
	const adapter = registry.get(configs[0].type);
	const items = await adapter?.getServiceData?.(configs[0], 'trending-by-category', { category }) ?? [];
	return json({ items });
};
