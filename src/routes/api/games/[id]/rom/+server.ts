import { error } from '@sveltejs/kit';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { downloadRomContent } from '$lib/adapters/romm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, request, locals }) => {
	if (!locals.user) throw error(401);

	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');

	const config = getServiceConfig(serviceId);
	if (!config || config.type !== 'romm') throw error(404);

	const userCred = getUserCredentialForService(locals.user.id, serviceId) ?? undefined;
	const range = request.headers.get('range') ?? undefined;

	// downloadRomContent supports range header which downloadContent interface does not
	const res = await downloadRomContent(config, params.id, userCred, range);
	if (!res.ok) throw error(res.status, 'Failed to fetch ROM');

	const headers = new Headers();
	headers.set('Content-Type', res.headers.get('Content-Type') ?? 'application/octet-stream');
	if (res.headers.get('Content-Length')) {
		headers.set('Content-Length', res.headers.get('Content-Length')!);
	}
	if (res.headers.get('Content-Range')) {
		headers.set('Content-Range', res.headers.get('Content-Range')!);
	}
	headers.set('Accept-Ranges', 'bytes');
	headers.set('Cache-Control', 'private, max-age=3600');

	return new Response(res.body, {
		status: res.status,
		headers
	});
};
