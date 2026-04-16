import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { PlaybackPlan, PlaybackSession, BrowserCaps } from '$lib/adapters/playback';

export async function negotiate(
	serviceId: string,
	itemId: string,
	plan: PlaybackPlan,
	caps: BrowserCaps,
	userId: string
): Promise<PlaybackSession> {
	const config = getServiceConfig(serviceId);
	if (!config) throw new Error(`Service not found: ${serviceId}`);

	const adapter = registry.get(config.type);
	if (!adapter?.negotiatePlayback) {
		throw new Error(`Adapter ${config.type} does not support playback negotiation`);
	}

	const userCred = getUserCredentialForService(userId, serviceId) ?? undefined;

	return adapter.negotiatePlayback(
		config,
		userCred,
		{ id: itemId, type: config.type },
		plan,
		caps
	);
}
