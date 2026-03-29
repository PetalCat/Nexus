import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });
	const sort = url.searchParams.get('sort') ?? undefined;
	const adapter = registry.get(configs[0].type);
	const result = await adapter?.getServiceData?.(configs[0], 'comments', { videoId: params.id, sort });
	return json(result);
};
