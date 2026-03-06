import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getComments } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });
	const sort = url.searchParams.get('sort') ?? undefined;
	const result = await getComments(configs[0], params.id, sort);
	return json(result);
};
