import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { invidiousAdapter } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ items: [] });
	const items = await invidiousAdapter.getRecentlyAdded!(configs[0]);
	return json({ items });
};
