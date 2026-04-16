import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { withStaleCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

/** Allowlisted third-party image hosts that the proxy will fetch when
 *  `path` is an absolute URL. Keeps the proxy from being an open relay. */
const THIRD_PARTY_IMAGE_HOSTS = [
	'yt3.ggpht.com',
	'i.ytimg.com',
	'lh3.googleusercontent.com',
	'image.tmdb.org',
];

/**
 * Image proxy — fetches images from backend services that require auth
 * (RomM, Calibre-Web, etc.) and returns them to the browser.
 *
 * Query params:
 *   service — service ID
 *   path    — path on the service (e.g. /assets/romm/resources/roms/.../cover/big.jpeg)
 *              OR an absolute URL on an allowlisted third-party host.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const serviceId = url.searchParams.get('service');
	const imagePath = url.searchParams.get('path');

	if (!serviceId || !imagePath) {
		return new Response('Missing service or path', { status: 400 });
	}

	// Third-party absolute URL path — no service auth needed, just validate
	// the host is on the allowlist and proxy the bytes.
	if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
		let parsed: URL;
		try { parsed = new URL(imagePath); } catch {
			return new Response('Invalid URL', { status: 400 });
		}
		if (!THIRD_PARTY_IMAGE_HOSTS.includes(parsed.hostname)) {
			return new Response('Host not allowlisted', { status: 403 });
		}
		const cacheKey = `media-image:third-party:${imagePath}`;
		try {
			const cached = await withStaleCache(cacheKey, 15 * 60 * 1000, 24 * 60 * 60 * 1000, async () => {
				const res = await fetch(imagePath, { signal: AbortSignal.timeout(20_000), redirect: 'follow' });
				if (!res.ok) throw new Error(`upstream:${res.status}`);
				return {
					body: await res.arrayBuffer(),
					contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
					contentLength: res.headers.get('Content-Length'),
					lastModified: res.headers.get('Last-Modified'),
				};
			});
			const responseHeaders = new Headers();
			responseHeaders.set('Content-Type', cached.contentType);
			if (cached.contentLength) responseHeaders.set('Content-Length', cached.contentLength);
			if (cached.lastModified) responseHeaders.set('Last-Modified', cached.lastModified);
			responseHeaders.set('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
			return new Response(cached.body.slice(0), { status: 200, headers: responseHeaders });
		} catch {
			return new Response('Failed to fetch image', { status: 502 });
		}
	}

	const config = getServiceConfig(serviceId);
	if (!config) return new Response('Service not found', { status: 404 });

	const adapter = registry.get(config.type);
	const userCred = locals.user?.id && adapter?.userLinkable
		? getUserCredentialForService(locals.user.id, serviceId) ?? undefined
		: undefined;

	// Build auth headers via adapter method (falls back to generic token if not implemented)
	const headers: Record<string, string> = {};

	if (adapter?.getImageHeaders) {
		Object.assign(headers, await adapter.getImageHeaders(config, userCred));
	} else {
		// Generic fallback: try user token or API key
		if (userCred?.accessToken) {
			headers['Authorization'] = `Bearer ${userCred.accessToken}`;
		} else if (config.apiKey) {
			headers['Authorization'] = `Bearer ${config.apiKey}`;
		}
	}

	const imageUrl = `${config.url}${imagePath}`;
const cacheKey = `media-image:${locals.user.id}:${serviceId}:${imagePath}`;
	const imageTtlMs = 15 * 60 * 1000;
	const imageStaleTtlMs = 24 * 60 * 60 * 1000;

	try {
		const cached = await withStaleCache(cacheKey, imageTtlMs, imageStaleTtlMs, async () => {
			const res = await fetch(imageUrl, {
				headers,
				signal: AbortSignal.timeout(20_000),
				redirect: 'follow'
			});

			if (!res.ok) {
				throw new Error(`upstream:${res.status}`);
			}

			return {
				body: await res.arrayBuffer(),
				contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
				contentLength: res.headers.get('Content-Length'),
				lastModified: res.headers.get('Last-Modified')
			};
		});

		const responseHeaders = new Headers();
		responseHeaders.set('Content-Type', cached.contentType);
		if (cached.contentLength) responseHeaders.set('Content-Length', cached.contentLength);
		if (cached.lastModified) responseHeaders.set('Last-Modified', cached.lastModified);
		responseHeaders.set('Cache-Control', 'private, max-age=604800, stale-while-revalidate=86400');

		return new Response(cached.body.slice(0), { status: 200, headers: responseHeaders });
	} catch {
		return new Response('Failed to fetch image', { status: 502 });
	}
};
