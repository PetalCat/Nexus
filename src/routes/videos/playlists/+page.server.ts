import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { buildAccountServiceSummary } from '$lib/server/account-services';
import { runWithAutoRefresh } from '$lib/adapters/registry-auth';
import { AdapterAuthError } from '$lib/adapters/errors';
import type { AccountServiceSummary } from '$lib/components/account-linking/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) {
		return {
			playlists: [],
			hasLinkedAccount: false,
			invidiousSummary: null as AccountServiceSummary | null
		};
	}

	const config = configs[0];
	const cred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;
	const hasLinkedAccount = !!cred?.accessToken;
	const invidiousSummary = buildAccountServiceSummary(userId ?? null, config.id);

	if (!hasLinkedAccount || !cred || !userId) {
		return { playlists: [], hasLinkedAccount, invidiousSummary };
	}

	try {
		const adapter = registry.get(config.type);
		const playlists = await runWithAutoRefresh(config, userId, cred, async (refreshedCred) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return (await adapter?.getServiceData?.(config, 'playlists', {}, refreshedCred!) as any[]) ?? [];
		});
		return { playlists, hasLinkedAccount, invidiousSummary };
	} catch (err) {
		if (!AdapterAuthError.is(err)) {
			console.error('[videos/playlists] feed error:', err);
		}
		const refreshedSummary = buildAccountServiceSummary(userId, config.id);
		return { playlists: [], hasLinkedAccount, invidiousSummary: refreshedSummary };
	}
};
