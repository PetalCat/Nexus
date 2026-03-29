import { error } from '@sveltejs/kit';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { deleteRomSave } from '$lib/adapters/romm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401);
	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');
	const config = getServiceConfig(serviceId);
	if (!config || config.type !== 'romm') throw error(404);
	const adapter = registry.get(config.type);
	const userCred = getUserCredentialForService(locals.user.id, serviceId) ?? undefined;

	const res = await adapter?.downloadContent?.(config, params.id, `save:${params.saveId}`, userCred);
	if (!res?.ok) throw error(res?.status ?? 500, 'Failed to download save');

	const headers = new Headers();
	headers.set('Content-Type', res.headers.get('Content-Type') ?? 'application/octet-stream');
	if (res.headers.get('Content-Length')) {
		headers.set('Content-Length', res.headers.get('Content-Length')!);
	}
	headers.set('Content-Disposition', `attachment; filename="save-${params.saveId}"`);

	return new Response(res.body, { status: 200, headers });
};

export const DELETE: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401);
	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');
	const config = getServiceConfig(serviceId);
	if (!config || config.type !== 'romm') throw error(404);
	const userCred = getUserCredentialForService(locals.user.id, serviceId) ?? undefined;

	const ok = await deleteRomSave(config, params.id, params.saveId, userCred);
	if (!ok) throw error(500, 'Failed to delete save');

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
};
