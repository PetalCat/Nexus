import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { UnifiedMedia } from '$lib/adapters/types';

// GET /api/video/subscriptions/feed?page=1
// Returns subscription videos grouped by date: { today, thisWeek, earlier }
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ today: [], thisWeek: [], earlier: [] });

	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	const page = parseInt(url.searchParams.get('page') ?? '1');
	const adapter = registry.get(config.type);
	const feed = await adapter?.getServiceData?.(config, 'subscription-feed', { page }, userCred) as { notifications: UnifiedMedia[]; videos: UnifiedMedia[] } | null;
	if (!feed) return json({ today: [], thisWeek: [], earlier: [] });

	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const startOfWeek = startOfToday - now.getDay() * 86400_000; // Sunday as week start

	const today: UnifiedMedia[] = [];
	const thisWeek: UnifiedMedia[] = [];
	const earlier: UnifiedMedia[] = [];

	// Invidious puts recent uploads in `notifications`, not `videos`
	const allVideos = [...feed.notifications, ...feed.videos];
	for (const video of allVideos) {
		// metadata.published is unix seconds from Invidious
		const publishedSec = video.metadata?.published as number | undefined;
		if (!publishedSec) {
			earlier.push(video);
			continue;
		}

		const publishedMs = publishedSec * 1000;
		if (publishedMs >= startOfToday) {
			today.push(video);
		} else if (publishedMs >= startOfWeek) {
			thisWeek.push(video);
		} else {
			earlier.push(video);
		}
	}

	return json({ today, thisWeek, earlier });
};
