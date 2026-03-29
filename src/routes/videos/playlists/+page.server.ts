import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return { playlists: [], hasLinkedAccount: false };

	const config = configs[0];
	const cred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;
	const hasLinkedAccount = !!cred?.accessToken;

	if (!hasLinkedAccount || !cred) {
		return { playlists: [], hasLinkedAccount };
	}

	try {
		const adapter = registry.get(config.type);
		const playlists = await adapter?.getServiceData?.(config, 'playlists', {}, cred) as any[] ?? [];
		return { playlists, hasLinkedAccount };
	} catch {
		return { playlists: [], hasLinkedAccount };
	}
};
