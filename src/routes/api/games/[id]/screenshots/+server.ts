import { json, error } from '@sveltejs/kit';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401);
	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');
	const config = getServiceConfig(serviceId);
	if (!config || config.type !== 'romm') throw error(404);
	const adapter = registry.get(config.type);
	const userCred = getUserCredentialForService(locals.user.id, serviceId) ?? undefined;
	const enriched = await adapter?.enrichItem?.(config, { sourceId: params.id } as any, 'screenshots', userCred);
	return json(enriched?.metadata?.screenshots ?? []);
};
