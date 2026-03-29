import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const q = url.searchParams.get('q');
	if (!q) return json({ suggestions: [] });
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ suggestions: [] });
	const adapter = registry.get(configs[0].type);
	const result = await adapter?.getServiceData?.(configs[0], 'search-suggestions', { query: q });
	return json(result);
};
