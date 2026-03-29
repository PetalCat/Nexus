import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';

/** GET /api/live/guide?channelId=xxx — single channel schedule (24h) */
/** GET /api/live/guide — all channels guide (4h) */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const channelId = url.searchParams.get('channelId');
	const jellyfinConfigs = getConfigsForMediaType('live');

	if (jellyfinConfigs.length === 0) {
		return json({ guide: channelId ? [] : {} });
	}

	const config = jellyfinConfigs[0];
	const adapter = registry.get(config.type);
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;

	if (channelId) {
		const programs = await withCache(
			`live:guide:${config.id}:${channelId}:${locals.user.id}`,
			120_000,
			() => adapter?.getServiceData?.(config, 'programs', { channelId }, userCred) ?? Promise.resolve([])
		);
		return json({ guide: programs });
	}

	const guide = await withCache(
		`live:guide:all:${config.id}:${locals.user.id}`,
		120_000,
		() => adapter?.getServiceData?.(config, 'tv-guide', {}, userCred) ?? Promise.resolve({})
	);
	return json({ guide });
};
