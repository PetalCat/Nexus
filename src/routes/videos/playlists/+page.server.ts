import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getUserPlaylists } from '$lib/adapters/invidious';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	const configs = getEnabledConfigs().filter((c) => c.type === 'invidious');
	if (configs.length === 0) return { playlists: [], hasLinkedAccount: false };

	const config = configs[0];
	const cred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;
	const hasLinkedAccount = !!cred?.accessToken;

	if (!hasLinkedAccount || !cred) {
		return { playlists: [], hasLinkedAccount };
	}

	try {
		const playlists = await getUserPlaylists(config, cred);
		return { playlists, hasLinkedAccount };
	} catch {
		return { playlists: [], hasLinkedAccount };
	}
};
