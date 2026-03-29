import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getPlatforms } from '$lib/adapters/romm';
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
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const platforms = await getPlatforms(config, userCred);

	if (platformId) {
		const platform = platforms.find((p) => String(p.id) === platformId);
		if (!platform) return json({ error: 'Platform not found' }, { status: 404 });
		return json({ platform: enrichPlatform(platform) });
	}

	return json({
		platforms: platforms.map(enrichPlatform)
	});
};
