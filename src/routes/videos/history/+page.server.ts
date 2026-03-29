import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { UnifiedMedia } from '$lib/adapters/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return { videos: [], hasMore: false, hasLinkedAccount: false };

	const config = configs[0];
	const cred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;
	const hasLinkedAccount = !!cred?.accessToken;

	if (!hasLinkedAccount || !cred) {
		return { videos: [], hasMore: false, hasLinkedAccount };
	}

	const adapter = registry.get(config.type);
	try {
		const videoIds = await adapter?.getServiceData?.(config, 'watch-history', { page: 1 }, cred) as string[] ?? [];
		const first24 = videoIds.slice(0, 24);

		const videos = (
			await Promise.all(
				first24.map(async (id) => {
					try {
						return await adapter?.getItem?.(config, id, cred) ?? null;
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
