import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getTrendingByCategory } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const category = url.searchParams.get('type') ?? undefined;
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ items: [] });
	const items = await getTrendingByCategory(configs[0], category as any);
	return json({ items });
};
