import { registry } from '$lib/adapters/registry';
import { checkAllServices, getServiceConfigs } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const services = getServiceConfigs();
	const available = registry.all().map((a) => ({
		id: a.id,
		displayName: a.displayName,
		defaultPort: a.defaultPort,
		icon: a.icon,
		mediaTypes: a.mediaTypes
	}));

	// Health check for all configured services
	const health = services.length > 0 ? await checkAllServices() : [];

	return { services, available, health };
};
