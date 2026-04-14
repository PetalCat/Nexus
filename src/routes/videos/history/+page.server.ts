import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { buildAccountServiceSummary } from '$lib/server/account-services';
import { runWithAutoRefresh } from '$lib/adapters/registry-auth';
import { AdapterAuthError } from '$lib/adapters/errors';
import type { UnifiedMedia } from '$lib/adapters/types';
import type { AccountServiceSummary } from '$lib/components/account-linking/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) {
		return {
			videos: [],
			hasMore: false,
			hasLinkedAccount: false,
			invidiousSummary: null as AccountServiceSummary | null
		};
	}

	const config = configs[0];
	const cred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;
	const hasLinkedAccount = !!cred?.accessToken;
	const invidiousSummary = buildAccountServiceSummary(userId ?? null, config.id);

	if (!hasLinkedAccount || !cred || !userId) {
		return { videos: [], hasMore: false, hasLinkedAccount, invidiousSummary };
	}

	const adapter = registry.get(config.type);
	try {
		const result = await runWithAutoRefresh(config, userId, cred, async (refreshedCred) => {
			const videoIds = await adapter?.getServiceData?.(config, 'watch-history', { page: 1 }, refreshedCred!) as string[] ?? [];
			const first24 = videoIds.slice(0, 24);

			const videos = (
				await Promise.all(
					first24.map(async (id) => {
						try {
							return await adapter?.getItem?.(config, id, refreshedCred!) ?? null;
						} catch {
							return null;
						}
					})
				)
			).filter((v): v is UnifiedMedia => v !== null);

			return { videos, hasMore: videoIds.length > 24 };
		});

		return { ...result, hasLinkedAccount, invidiousSummary };
	} catch (err) {
		if (!AdapterAuthError.is(err)) {
			console.error('[videos/history] feed error:', err);
		}
		const refreshedSummary = buildAccountServiceSummary(userId, config.id);
		return { videos: [], hasMore: false, hasLinkedAccount, invidiousSummary: refreshedSummary };
	}
};
