import { error } from '@sveltejs/kit';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const userId = locals.user?.id;
	if (!userId) throw error(401, 'Not authenticated');

	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');

	const config = getServiceConfig(serviceId);
	if (!config || config.type !== 'romm') throw error(404, 'RomM service not found');

	const userCred = getUserCredentialForService(userId, serviceId) ?? undefined;
	const headers: Record<string, string> = {};

	if (userCred?.accessToken) {
		headers['Authorization'] = `Bearer ${userCred.accessToken}`;
	} else if (config.username && config.password) {
		headers['Authorization'] = `Basic ${btoa(`${config.username}:${config.password}`)}`;
	} else if (config.apiKey) {
		headers['Authorization'] = `Bearer ${config.apiKey}`;
	}

	const baseUrl = config.url.replace(/\/+$/, '');
	const romRes = await fetch(`${baseUrl}/api/roms/${params.id}/content`, {
		headers,
		signal: AbortSignal.timeout(120000)
	});

	if (!romRes.ok) {
		throw error(romRes.status, `Failed to download ROM: ${romRes.statusText}`);
	}

	const contentDisposition = romRes.headers.get('content-disposition') ?? `attachment; filename="rom-${params.id}"`;
	const contentType = romRes.headers.get('content-type') ?? 'application/octet-stream';
	const contentLength = romRes.headers.get('content-length');

	const responseHeaders: Record<string, string> = {
		'Content-Type': contentType,
		'Content-Disposition': contentDisposition
	};
	if (contentLength) responseHeaders['Content-Length'] = contentLength;

	return new Response(romRes.body, { headers: responseHeaders });
};
