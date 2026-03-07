import { json, error } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.user?.id;
	const serviceId = url.searchParams.get('service');
	const seriesId = url.searchParams.get('seriesId');
	const season = url.searchParams.get('season');

	if (!serviceId || !seriesId || season == null) {
		throw error(400, 'Missing service, seriesId, or season');
	}

	const config = getServiceConfig(serviceId);
	if (!config) throw error(404, 'Service not found');

	const adapter = registry.get(config.type);
	if (!adapter?.getSeasonEpisodes) throw error(501, 'Service does not support episodes');

	const userCred = userId && adapter.userLinkable
		? getUserCredentialForService(userId, serviceId) ?? undefined
		: undefined;

	const episodes = await adapter.getSeasonEpisodes(config, seriesId, parseInt(season, 10), userCred);
	return json(episodes);
};
