import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';
import { buildAccountServiceSummary } from '$lib/server/account-services';
import { runWithAutoRefresh } from '$lib/adapters/registry-auth';
import { AdapterAuthError } from '$lib/adapters/errors';
import type { UnifiedMedia } from '$lib/adapters/types';
import type { AccountServiceSummary } from '$lib/components/account-linking/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.user?.id;
	const configs = getConfigsForMediaType('video');
	const hasVideoProvider = configs.length > 0;
	const category = (url.searchParams.get('category') as 'music' | 'gaming' | 'news' | 'movies') || undefined;

	let trending: UnifiedMedia[] = [];
	let hasLinkedAccount = false;
	let invidiousSummary: AccountServiceSummary | null = null;

	if (hasVideoProvider && configs[0]) {
		const config = configs[0];
		const cred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;
		hasLinkedAccount = !!cred?.accessToken;
		invidiousSummary = buildAccountServiceSummary(userId ?? null, config.id);

		const adapter = registry.get(config.type);
		trending = await withCache(`videos:trending:${category ?? 'all'}`, 120_000, () =>
			adapter?.getServiceData?.(config, 'trending-by-category', { category }) as Promise<UnifiedMedia[]>
		);

		if (hasLinkedAccount && userId) {
			// Stream subscription feed — don't block page load. Wrapped in
			// runWithAutoRefresh so a stale SID triggers silent refresh via
			// refreshCredential + stored_password. If the refresh fails, the
			// credential is marked stale and invidiousSummary on the next load
			// will show the StaleCredentialBanner.
			const subscriptionFeed = withCache(`videos:subfeed:${userId}`, 60_000, async () => {
				try {
					return await runWithAutoRefresh(config, userId, cred, async (refreshedCred) => {
						const feed = await adapter?.getServiceData?.(
							config,
							'subscription-feed',
							{},
							refreshedCred!
						) as { notifications: UnifiedMedia[]; videos: UnifiedMedia[] } | null;
						if (!feed) return [] as UnifiedMedia[];
						return [...feed.notifications, ...feed.videos];
					});
				} catch (err) {
					// AdapterAuthError propagates with stale_since already set by
					// registry-auth. Plain errors are logged but don't poison state.
					if (!AdapterAuthError.is(err)) {
						console.error('[videos] subscription feed error:', err);
					}
					return [] as UnifiedMedia[];
				}
			});

			return { trending, subscriptionFeed, hasVideoProvider, hasLinkedAccount, category, invidiousSummary };
		}
	}

	return {
		trending,
		subscriptionFeed: Promise.resolve([] as UnifiedMedia[]),
		hasVideoProvider,
		hasLinkedAccount,
		category,
		invidiousSummary
	};
};
