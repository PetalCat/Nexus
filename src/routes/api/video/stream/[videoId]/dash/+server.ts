import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { invidiousCookieHeaders } from '$lib/adapters/invidious/client';
import type { RequestHandler } from './$types';

/**
 * Privacy-preserving DASH manifest for Invidious videos.
 *
 * Fetches the DASH MPD from Invidious and rewrites all BaseURL entries
 * to route through the dedicated stream proxy sub-server (port 3939).
 * The browser never contacts Google — all segments are proxied.
 *
 * The manifest already contains direct googlevideo.com CDN URLs with
 * proper clen/indexRange values. We pass the full CDN URL to the proxy
 * so it can fetch the exact bytes dash.js requests via range headers.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const { videoId } = params;
	const invConfig = getConfigsForMediaType('video')[0];
	if (!invConfig) return new Response('No Invidious service', { status: 404 });

	const userCred = getUserCredentialForService(locals.user.id, invConfig.id) ?? undefined;
	const headers: Record<string, string> = { ...invidiousCookieHeaders(userCred) };

	const res = await fetch(
		`${invConfig.url}/api/manifest/dash/id/${encodeURIComponent(videoId)}`,
		{ headers, redirect: 'follow', signal: AbortSignal.timeout(10_000) }
	);
	if (!res.ok) return new Response('Failed to fetch manifest', { status: res.status });

	let mpd = await res.text();

	// Rewrite BaseURL: route CDN URLs through the Node reverse-proxy at
	// /api/stream-proxy/proxy?url=... so the browser never talks to port 3939
	// directly (unreachable in Docker) and CSP connect-src 'self' is honored.
	mpd = mpd.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_match, rawCdnUrl: string) => {
		const cdnUrl = rawCdnUrl.replace(/&amp;/g, '&');
		return `<BaseURL>/api/stream-proxy/proxy?url=${encodeURIComponent(cdnUrl)}</BaseURL>`;
	});

	return new Response(mpd, {
		headers: {
			'Content-Type': 'application/dash+xml',
			'Cache-Control': 'private, max-age=300'
		}
	});
};
