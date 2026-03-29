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
	const enriched = await adapter?.enrichItem?.(config, { sourceId: params.id } as any, 'saves', userCred);
	const saves = (enriched?.metadata?.saves ?? []) as any[];
	const proxied = saves.map(s => ({
		...s,
		screenshot_url: s.screenshot_url
			? `/api/media/image?service=${serviceId}&path=${encodeURIComponent(new URL(s.screenshot_url).pathname)}`
			: undefined
	}));
	return json(proxied);
};

export const POST: RequestHandler = async ({ params, request, locals, url }) => {
	if (!locals.user) throw error(401);
	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');
	const config = getServiceConfig(serviceId);
	if (!config || config.type !== 'romm') throw error(404);
	const adapter = registry.get(config.type);
	const userCred = getUserCredentialForService(locals.user.id, serviceId) ?? undefined;

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	if (!file) throw error(400, 'file required');

	await adapter?.uploadContent?.(config, params.id, 'save', file, file.name, userCred);

	return json({ ok: true });
};
