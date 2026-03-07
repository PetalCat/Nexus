import { json, error } from '@sveltejs/kit';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getRomSaves, uploadRomSave } from '$lib/adapters/romm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401);
	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');
	const config = getServiceConfig(serviceId);
	if (!config || config.type !== 'romm') throw error(404);
	const userCred = getUserCredentialForService(locals.user.id, serviceId) ?? undefined;
	const saves = await getRomSaves(config, params.id, userCred);
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
	const userCred = getUserCredentialForService(locals.user.id, serviceId) ?? undefined;

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	if (!file) throw error(400, 'file required');
	const screenshot = formData.get('screenshot') as File | null;

	const ok = await uploadRomSave(config, params.id, file, file.name, userCred, screenshot ?? undefined);
	if (!ok) {
		return json({ ok: false, error: 'RomM rejected the upload' }, { status: 502 });
	}

	return json({ ok: true });
};
