import type { RequestHandler } from './$types';
import { resolveServiceConfig } from '$lib/server/v2-services';

/**
 * GET /api/subtitles/jellyfin?service=&item=&source=&index= — server-side
 * WebVTT subtitle proxy for the v2 Jellyfin adapter.
 *
 * The v2 adapter surfaces text subtitle tracks with a `url` pointing here
 * (never at the Jellyfin origin, never carrying the token). This route resolves
 * the single service cred install-side, fetches the canonical
 * `/Videos/{item}/{source}/Subtitles/{index}/Stream.vtt` (Jellyfin converts
 * SRT/ASS→WebVTT, which is all a `<track>` can consume), and returns it as
 * `text/vtt`. Thin: no caching, no rewriting — just credential-injected fetch.
 */
function authHeader(apiKey: string, serviceId: string): string {
	return `MediaBrowser Token="${apiKey}", Client="Nexus", Device="Nexus Server", DeviceId="nexus-${serviceId}", Version="1.0.0"`;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const service = url.searchParams.get('service');
	const item = url.searchParams.get('item');
	const source = url.searchParams.get('source');
	const index = url.searchParams.get('index');
	if (!service || !item || !source || index === null) {
		return new Response('Missing service/item/source/index', { status: 400 });
	}

	const config = resolveServiceConfig(service);
	if (!config || !config.apiKey) {
		return new Response('Backend not configured', { status: 404 });
	}

	const upstream = `${config.url.replace(/\/+$/, '')}/Videos/${encodeURIComponent(item)}/${encodeURIComponent(source)}/Subtitles/${encodeURIComponent(index)}/Stream.vtt`;

	let res: Response;
	try {
		res = await fetch(upstream, {
			headers: {
				Authorization: authHeader(config.apiKey, config.id),
				'X-Emby-Token': config.apiKey
			},
			signal: AbortSignal.timeout(8000)
		});
	} catch (e) {
		console.warn('[subtitles/jellyfin] fetch error:', e);
		return new Response('subtitle upstream unavailable', { status: 502 });
	}

	if (!res.ok) {
		return new Response(`subtitle upstream → ${res.status}`, { status: res.status });
	}

	return new Response(res.body, {
		status: 200,
		headers: {
			'content-type': 'text/vtt; charset=utf-8',
			'cache-control': 'private, max-age=300'
		}
	});
};
