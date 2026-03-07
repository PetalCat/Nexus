import { error } from '@sveltejs/kit';
import { getServiceConfig, getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getRomSaves, getRomStates } from '$lib/adapters/romm';
import { isPlayableInBrowser, getEmulatorJSConfig } from '$lib/emulator/cores';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401);

	let serviceId = url.searchParams.get('serviceId');

	// Find the RomM service if not specified
	if (!serviceId) {
		const rommConfigs = getEnabledConfigs().filter((c) => c.type === 'romm');
		if (rommConfigs.length > 0) serviceId = rommConfigs[0].id;
	}
	if (!serviceId) throw error(400, 'serviceId required');

	const config = getServiceConfig(serviceId);
	if (!config || config.type !== 'romm') throw error(404, 'RomM service not found');

	const adapter = registry.get('romm');
	if (!adapter?.getItem) throw error(501);

	const userCred = getUserCredentialForService(locals.user.id, serviceId) ?? undefined;
	const item = await adapter.getItem(config, params.id, userCred);
	if (!item) throw error(404, 'Game not found');

	const platformSlug = item.metadata?.platformSlug as string | undefined;
	if (!platformSlug || !isPlayableInBrowser(platformSlug)) {
		throw error(400, `Platform "${platformSlug ?? 'unknown'}" is not supported for in-browser emulation`);
	}

	const romUrl = `/api/games/${params.id}/rom?serviceId=${serviceId}`;
	const ejsConfig = getEmulatorJSConfig(platformSlug, romUrl);
	if (!ejsConfig) throw error(500, 'Could not resolve emulator config');

	// Fetch saves/states for the toolbar
	const [saves, states] = await Promise.all([
		getRomSaves(config, params.id, userCred),
		getRomStates(config, params.id, userCred)
	]);

	return {
		item,
		serviceId,
		ejsConfig,
		saves,
		states
	};
};
