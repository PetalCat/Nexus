import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getWatchHistory, invidiousAdapter } from '$lib/adapters/invidious';
import type { UnifiedMedia } from '$lib/adapters/types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const page = parseInt(url.searchParams.get('page') ?? '1', 10);
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '24', 10), 48);

	const configs = getEnabledConfigs().filter((c) => c.type === 'invidious');
	if (configs.length === 0) return json({ items: [], hasMore: false });

	const config = configs[0];
	const cred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!cred?.accessToken) return json({ items: [], hasMore: false });

	try {
		const videoIds = await getWatchHistory(config, cred, page);
		const pageIds = videoIds.slice(0, limit);

		const items = (
			await Promise.all(
				pageIds.map(async (id) => {
					try {
						return await invidiousAdapter.getItem!(config, id, cred);
					} catch {
						return null;
					}
				})
			)
		).filter((v): v is UnifiedMedia => v !== null);

		return json({ items, hasMore: videoIds.length > limit });
	} catch {
		return json({ items: [], hasMore: false });
	}
};
