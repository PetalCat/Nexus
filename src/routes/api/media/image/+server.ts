import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getSession as getCalibreSession } from '$lib/adapters/calibre';
import type { RequestHandler } from './$types';

/**
 * Image proxy — fetches images from backend services that require auth
 * (RomM, Calibre-Web, etc.) and returns them to the browser.
 *
 * Query params:
 *   service — service ID
 *   path    — path on the service (e.g. /assets/romm/resources/roms/.../cover/big.jpeg)
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const serviceId = url.searchParams.get('service');
	const imagePath = url.searchParams.get('path');

	if (!serviceId || !imagePath) {
		return new Response('Missing service or path', { status: 400 });
	}

	const config = getServiceConfig(serviceId);
	if (!config) return new Response('Service not found', { status: 404 });

	const adapter = registry.get(config.type);
	const userCred = locals.user?.id && adapter?.userLinkable
		? getUserCredentialForService(locals.user.id, serviceId) ?? undefined
		: undefined;

	// Build auth headers based on service type
	const headers: Record<string, string> = {};

	if (config.type === 'romm') {
		if (userCred?.externalUsername && userCred?.accessToken) {
			headers['Authorization'] = 'Basic ' + btoa(`${userCred.externalUsername}:${userCred.accessToken}`);
		} else if (config.apiKey) {
			headers['Authorization'] = `Bearer ${config.apiKey}`;
		} else if (config.username && config.password) {
			headers['Authorization'] = 'Basic ' + btoa(`${config.username}:${config.password}`);
		}
	} else if (config.type === 'calibre') {
		// Calibre-Web uses session cookies — reuse the adapter's session manager
		try {
			const cookie = await getCalibreSession(config, userCred);
			headers['Cookie'] = cookie;
		} catch {
			return new Response('Calibre auth failed', { status: 401 });
		}
	} else {
		// Generic: try API key or user token
		if (userCred?.accessToken) {
			headers['Authorization'] = `Bearer ${userCred.accessToken}`;
		} else if (config.apiKey) {
			headers['Authorization'] = `Bearer ${config.apiKey}`;
		}
	}

	const imageUrl = `${config.url}${imagePath}`;

	try {
		const res = await fetch(imageUrl, {
			headers,
			signal: AbortSignal.timeout(10_000),
			redirect: 'follow'
		});

		if (!res.ok) {
			return new Response('Image not found', { status: res.status });
		}

		const responseHeaders = new Headers();
		const ct = res.headers.get('Content-Type');
		if (ct) responseHeaders.set('Content-Type', ct);
		const cl = res.headers.get('Content-Length');
		if (cl) responseHeaders.set('Content-Length', cl);
		responseHeaders.set('Cache-Control', 'public, max-age=86400');

		return new Response(res.body, { status: 200, headers: responseHeaders });
	} catch {
		return new Response('Failed to fetch image', { status: 502 });
	}
};
