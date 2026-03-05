import { getEnabledConfigs } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { getUserCredentialForService } from '$lib/server/auth';
import { withCache } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const configs = getEnabledConfigs();
	const userId = locals.user?.id;

	function cred(config: { id: string; type: string }) {
		if (!userId) return undefined;
		const adapter = registry.get(config.type);
		if (!adapter?.userLinkable) return undefined;
		return getUserCredentialForService(userId, config.id) ?? undefined;
	}

	// Per-user, 30s cache (same TTL as dashboard continue-watching)
	const continueWatching = await withCache(`activity:${userId ?? 'anon'}`, 30_000, () =>
		Promise.allSettled(
			configs.map((c) => registry.get(c.type)?.getContinueWatching?.(c, cred(c)) ?? Promise.resolve([]))
		).then((r) => r.flatMap((x) => (x.status === 'fulfilled' ? x.value : [])))
	);

	return { continueWatching };
};
