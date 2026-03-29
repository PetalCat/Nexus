import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getTrendingByCategory, getSubscriptionFeed } from '$lib/adapters/invidious';
import { withCache } from '$lib/server/cache';
import type { UnifiedMedia } from '$lib/adapters/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.user?.id;
	const configs = getConfigsForMediaType('video');
	const hasInvidious = configs.length > 0;
	const category = (url.searchParams.get('category') as 'music' | 'gaming' | 'news' | 'movies') || undefined;

	let trending: UnifiedMedia[] = [];
	let hasLinkedAccount = false;

	if (hasInvidious && configs[0]) {
		const config = configs[0];
		const cred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;
		hasLinkedAccount = !!cred?.accessToken;

		trending = await withCache(`videos:trending:${category ?? 'all'}`, 120_000, () =>
			getTrendingByCategory(config, category)
		);

		if (hasLinkedAccount) {
			// Stream subscription feed — don't block page load
			// Invidious puts recent uploads in `notifications`, not `videos`
			const subscriptionFeed = withCache(`videos:subfeed:${userId}`, 60_000, async () => {
				try {
					const feed = await getSubscriptionFeed(config, cred!);
					return [...feed.notifications, ...feed.videos];
				} catch (err) {
					console.error('[videos] subscription feed error:', err);
					return [] as UnifiedMedia[];
				}
			});

			return { trending, subscriptionFeed, hasInvidious, hasLinkedAccount, category };
		}
	}

	return {
		trending,
		subscriptionFeed: Promise.resolve([] as UnifiedMedia[]),
		hasInvidious,
		hasLinkedAccount,
		category
	};
};
