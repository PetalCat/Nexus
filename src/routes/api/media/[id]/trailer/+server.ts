import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceConfig, resolveUserCred } from '$lib/server/services';
import { resolveTrailerUrl } from '$lib/server/trailers';
import { registry } from '$lib/adapters/registry';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401);

	const serviceId = url.searchParams.get('service');
	if (!serviceId) throw error(400, 'Missing service param');

	const config = getServiceConfig(serviceId);
	if (!config) throw error(404, 'Service not found');

	const adapter = registry.get(config.type);
	if (!adapter) throw error(404, 'Adapter not found');

	// Fetch item to get metadata (including trailerUrl)
	const userCred = resolveUserCred(config, locals.user.id);
	const item = await adapter.getItem?.(config, params.id, userCred);
	if (!item) throw error(404, 'Item not found');

	const trailerUrl = await resolveTrailerUrl(
		params.id,
		serviceId,
		item.title,
		item.year,
		(item.metadata?.trailerUrl as string) ?? null,
		locals.user.id
	);

	return json({ trailer: trailerUrl });
};
