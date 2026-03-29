import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { enrichPlatform } from '$lib/server/platform-meta';

/**
 * GET /api/games/platforms — list all platforms with enriched metadata
 * GET /api/games/platforms?id=5 — single platform detail
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const platformId = url.searchParams.get('id');
	const rommConfigs = getConfigsForMediaType('game');

	if (rommConfigs.length === 0) {
		return json({ platforms: [] });
	}

	const config = rommConfigs[0];
	const adapter = registry.get(config.type);
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const categories = await adapter?.getCategories?.(config, userCred) ?? [];

	if (platformId) {
		const platform = categories.find((p) => p.id === platformId);
		if (!platform) return json({ error: 'Platform not found' }, { status: 404 });
		return json({ platform: enrichPlatform(platform as any) });
	}

	return json({
		platforms: categories.map((p) => enrichPlatform(p as any))
	});
};
