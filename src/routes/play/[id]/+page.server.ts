import { error } from '@sveltejs/kit';
import { getServiceConfig, getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { isPlayableInBrowser } from '$lib/emulator/cores';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401);

	let serviceId = url.searchParams.get('serviceId');

	if (!serviceId) {
		const rommConfigs = getConfigsForMediaType('game');
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

	// Fetch saves/states for the cloud save modal
	const [savesEnriched, statesEnriched] = await Promise.all([
		adapter.enrichItem?.(config, { sourceId: params.id } as any, 'saves', userCred),
		adapter.enrichItem?.(config, { sourceId: params.id } as any, 'states', userCred)
	]);
	const saves = (savesEnriched?.metadata?.saves ?? []) as any[];
	const states = (statesEnriched?.metadata?.states ?? []) as any[];

	// Proxy screenshot URLs through Nexus image proxy
	const proxyScreenshot = (url?: string) => {
		if (!url) return undefined;
		try {
			const path = new URL(url).pathname;
			return `/api/media/image?service=${serviceId}&path=${encodeURIComponent(path)}`;
		} catch { return undefined; }
	};

	return {
		item,
		serviceId,
		saves: saves.map(s => ({ ...s, screenshot_url: proxyScreenshot(s.screenshot_url) })),
		states: states.map(s => ({ ...s, screenshot_url: proxyScreenshot(s.screenshot_url) }))
	};
};
