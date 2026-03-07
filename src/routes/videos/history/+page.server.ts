import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getWatchHistory, invidiousAdapter } from '$lib/adapters/invidious';
import type { UnifiedMedia } from '$lib/adapters/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	const configs = getEnabledConfigs().filter((c) => c.type === 'invidious');
	if (configs.length === 0) return { videos: [], hasMore: false, hasLinkedAccount: false };

	const config = configs[0];
	const cred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;
	const hasLinkedAccount = !!cred?.accessToken;

	if (!hasLinkedAccount || !cred) {
		return { videos: [], hasMore: false, hasLinkedAccount };
	}

	try {
		const videoIds = await getWatchHistory(config, cred, 1);
		const first24 = videoIds.slice(0, 24);

		const videos = (
			await Promise.all(
				first24.map(async (id) => {
					try {
						return await invidiousAdapter.getItem!(config, id, cred);
					} catch {
						return null;
					}
				})
			)
		).filter((v): v is UnifiedMedia => v !== null);

		return { videos, hasMore: videoIds.length > 24, hasLinkedAccount };
	} catch {
		return { videos: [], hasMore: false, hasLinkedAccount };
	}
};
