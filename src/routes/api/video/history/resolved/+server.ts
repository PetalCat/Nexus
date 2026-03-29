import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { UnifiedMedia } from '$lib/adapters/types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const page = parseInt(url.searchParams.get('page') ?? '1', 10);
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '24', 10), 48);

	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ items: [], hasMore: false });

	const config = configs[0];
	const cred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!cred?.accessToken) return json({ items: [], hasMore: false });

	const adapter = registry.get(config.type);
	try {
		const videoIds = await adapter?.getServiceData?.(config, 'watch-history', { page }, cred) as string[] ?? [];
		const pageIds = videoIds.slice(0, limit);

		const items = (
			await Promise.all(
				pageIds.map(async (id) => {
					try {
						return await adapter?.getItem?.(config, id, cred) ?? null;
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
