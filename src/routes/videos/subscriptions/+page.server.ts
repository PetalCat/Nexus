import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getSubscriptionFeed } from '$lib/adapters/invidious';
import { withCache } from '$lib/server/cache';
import type { UnifiedMedia } from '$lib/adapters/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return { today: [], thisWeek: [], earlier: [], hasLinkedAccount: false };

	const config = configs[0];
	const cred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;
	const hasLinkedAccount = !!cred?.accessToken;

	if (!hasLinkedAccount || !cred) {
		return { today: [], thisWeek: [], earlier: [], hasLinkedAccount };
	}

	try {
		const allVideos = await withCache(`videos:subfeed:full:${userId}`, 60_000, async () => {
			const feed = await getSubscriptionFeed(config, cred);
			return [...feed.notifications, ...feed.videos] as UnifiedMedia[];
		});

		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const startOfWeek = new Date(startOfToday);
		startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

		const today: UnifiedMedia[] = [];
		const thisWeek: UnifiedMedia[] = [];
		const earlier: UnifiedMedia[] = [];

		for (const video of allVideos) {
			const pub = video.metadata?.published as number | undefined;
			if (!pub) { earlier.push(video); continue; }
			const date = new Date(pub * 1000);
			if (date >= startOfToday) today.push(video);
			else if (date >= startOfWeek) thisWeek.push(video);
			else earlier.push(video);
		}

		return { today, thisWeek, earlier, hasLinkedAccount };
	} catch {
		return { today: [], thisWeek: [], earlier: [], hasLinkedAccount };
	}
};
