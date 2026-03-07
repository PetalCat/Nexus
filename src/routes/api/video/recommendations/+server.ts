import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { UnifiedMedia } from '$lib/adapters/types';

// GET /api/video/recommendations?videoId=xxx&service=invidious
// Returns { recommendations: UnifiedMedia[] } — the recommended videos for the given video
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const videoId = url.searchParams.get('videoId');
	const serviceId = url.searchParams.get('service');
	if (!videoId) return json({ error: 'videoId required' }, { status: 400 });

	const configs = getEnabledConfigs().filter((c) => c.type === 'invidious');
	if (configs.length === 0) return json({ recommendations: [] });

	const config = serviceId
		? configs.find((c) => c.id === serviceId) ?? configs[0]
		: configs[0];

	const adapter = registry.get(config.type);
	if (!adapter?.getItem) return json({ recommendations: [] });

	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;

	try {
		const item: UnifiedMedia | null = await adapter.getItem(config, videoId, userCred);
		const recs = (item?.metadata?.recommendedVideos as UnifiedMedia[]) ?? [];
		return json({ recommendations: recs });
	} catch {
		return json({ recommendations: [] });
	}
};
