import { json, error } from '@sveltejs/kit';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { updateUserRomStatus } from '$lib/adapters/romm';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ params, request, locals, url }) => {
	if (!locals.user) throw error(401);
	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');
	const config = getServiceConfig(serviceId);
	if (!config || config.type !== 'romm') throw error(404);
	const userCred = getUserCredentialForService(locals.user.id, serviceId) ?? undefined;
	const { status } = await request.json();
	if (!status) throw error(400, 'status required');
	const ok = await updateUserRomStatus(config, params.id, status, userCred);
	if (!ok) throw error(500, 'Failed to update status');
	return json({ ok: true });
};
