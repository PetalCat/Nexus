import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getChannelPrograms, getLiveTvGuide } from '$lib/adapters/jellyfin';
import { withCache } from '$lib/server/cache';

/** GET /api/live/guide?channelId=xxx — single channel schedule (24h) */
/** GET /api/live/guide — all channels guide (4h) */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const channelId = url.searchParams.get('channelId');
	const jellyfinConfigs = getEnabledConfigs().filter((c) => c.type === 'jellyfin');

	if (jellyfinConfigs.length === 0) {
		return json({ guide: channelId ? [] : {} });
	}

	const config = jellyfinConfigs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;

	if (channelId) {
		const programs = await withCache(
			`live:guide:${config.id}:${channelId}:${locals.user.id}`,
			120_000,
			() => getChannelPrograms(config, channelId, userCred)
		);
		return json({ guide: programs });
	}

	const guide = await withCache(
		`live:guide:all:${config.id}:${locals.user.id}`,
		120_000,
		() => getLiveTvGuide(config, userCred)
	);
	return json({ guide });
};
