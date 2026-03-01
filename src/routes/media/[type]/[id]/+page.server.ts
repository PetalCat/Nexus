import { error } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getServiceConfig } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const serviceId = url.searchParams.get('service');
	if (!serviceId) throw error(400, 'Missing service parameter');

	const config = getServiceConfig(serviceId);
	if (!config) throw error(404, 'Service not found');

	const adapter = registry.get(config.type);
	if (!adapter?.getItem) throw error(501, 'This service does not support item detail');

	const item = await adapter.getItem(config, params.id);
	if (!item) throw error(404, 'Item not found');

	return { item, serviceType: config.type };
};
