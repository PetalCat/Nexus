import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getSearchSuggestions } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const q = url.searchParams.get('q');
	if (!q) return json({ suggestions: [] });
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ suggestions: [] });
	const result = await getSearchSuggestions(configs[0], q);
	return json(result);
};
