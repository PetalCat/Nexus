import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/**
 * Privacy-preserving Invidious video stream proxy.
 *
 * Uses Invidious's /latest_version endpoint which handles CDN resolution
 * and proxying natively. We follow the redirect chain and pipe the final
 * stream through to the client.
 *
 * Query params:
 *   itag — format itag (from /formats endpoint)
 */
export const GET: RequestHandler = async ({ params, url, request, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const { videoId } = params;

	const invConfig = getEnabledConfigs().find((c) => c.type === 'invidious');
	if (!invConfig) return new Response('No Invidious service configured', { status: 404 });

	const userCred = getUserCredentialForService(locals.user.id, invConfig.id) ?? undefined;

	// Default to itag 18 (360p muxed) if not specified
	const itag = url.searchParams.get('itag') ?? '18';

	// Use Invidious's built-in stream proxy
	const streamUrl = `${invConfig.url}/latest_version?id=${encodeURIComponent(videoId)}&itag=${encodeURIComponent(itag)}`;

	const proxyHeaders: Record<string, string> = {};
	if (userCred?.accessToken) proxyHeaders['Cookie'] = `SID=${userCred.accessToken}`;

	// Forward Range header for seeking
	const rangeHeader = request.headers.get('Range');
	if (rangeHeader) proxyHeaders['Range'] = rangeHeader;

	let upstream: Response;
	try {
		upstream = await fetch(streamUrl, {
			headers: proxyHeaders,
			redirect: 'follow'
		});
	} catch (err) {
		console.error('[video-stream] fetch error:', err instanceof Error ? err.message : err);
		return new Response('Stream fetch failed', { status: 502 });
	}

	if (!upstream.ok && upstream.status !== 206) {
		console.error('[video-stream] upstream', upstream.status, 'for', videoId, 'itag', itag);
		return new Response('Stream fetch failed', { status: upstream.status });
	}

	// Pipe response through without buffering
	const responseHeaders = new Headers();
	responseHeaders.set('Content-Type', upstream.headers.get('Content-Type') ?? 'video/mp4');
	responseHeaders.set('Accept-Ranges', 'bytes');
	responseHeaders.set('Cache-Control', 'private, max-age=3600');

	const contentLength = upstream.headers.get('Content-Length');
	if (contentLength) responseHeaders.set('Content-Length', contentLength);
	const contentRange = upstream.headers.get('Content-Range');
	if (contentRange) responseHeaders.set('Content-Range', contentRange);

	return new Response(upstream.body, {
		status: upstream.status,
		headers: responseHeaders
	});
};
