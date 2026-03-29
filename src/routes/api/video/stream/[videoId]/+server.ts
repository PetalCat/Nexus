import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/**
 * Privacy-preserving Invidious video stream proxy.
 *
 * Resolves the final CDN URL via Invidious (server-side, user IP hidden),
 * caches it, then proxies range requests directly to the CDN.
 * The user's IP never touches Google — our server is the intermediary.
 *
 * Query params:
 *   itag — format itag (from /formats endpoint)
 */

/** Preferred itags by priority — h264 for compatibility */
const PREFERRED_VIDEO_ITAGS = [
	'299', '137',  // 1080p60, 1080p
	'298', '136',  // 720p60, 720p
	'135',         // 480p
	'22',          // 720p muxed
	'18'           // 360p muxed
];

/** Muxed-only itags (video+audio in one stream) — for trailers and previews */
const PREFERRED_MUXED_ITAGS = [
	'22',  // 720p muxed
	'18'   // 360p muxed
];

/** Cache resolved CDN URLs: key = videoId:itag, value = { url, expires } */
const cdnCache = new Map<string, { url: string; expires: number }>();

/** Cache resolved best itag per video */
const itagCache = new Map<string, { itag: string; expires: number }>();

async function resolveBestItag(baseUrl: string, videoId: string, headers: Record<string, string>, muxedOnly = false): Promise<string | null> {
	const cacheKey = muxedOnly ? `${videoId}:muxed` : videoId;
	const cached = itagCache.get(cacheKey);
	if (cached && cached.expires > Date.now()) return cached.itag;

	try {
		const res = await fetch(
			`${baseUrl}/api/v1/videos/${encodeURIComponent(videoId)}?fields=formatStreams,adaptiveFormats`,
			{ headers, signal: AbortSignal.timeout(8000) }
		);
		if (!res.ok) return null;
		const meta = await res.json();

		const available = new Set<string>();
		for (const f of (meta.formatStreams ?? [])) available.add(String(f.itag));
		for (const f of (meta.adaptiveFormats ?? [])) available.add(String(f.itag));

		const preferredList = muxedOnly ? PREFERRED_MUXED_ITAGS : PREFERRED_VIDEO_ITAGS;
		for (const itag of preferredList) {
			if (available.has(itag)) {
				itagCache.set(cacheKey, { itag, expires: Date.now() + 10 * 60 * 1000 });
				return itag;
			}
		}
	} catch { /* fall through */ }

	return null;
}

/** Resolve the final CDN URL by following redirects (HEAD request) */
async function resolveCdnUrl(invUrl: string, videoId: string, itag: string, headers: Record<string, string>): Promise<string | null> {
	const cacheKey = `${videoId}:${itag}`;
	const cached = cdnCache.get(cacheKey);
	if (cached && cached.expires > Date.now()) return cached.url;

	const streamUrl = `${invUrl}/latest_version?id=${encodeURIComponent(videoId)}&itag=${encodeURIComponent(itag)}`;

	try {
		// Use redirect: 'manual' to capture the final URL after redirects
		const res = await fetch(streamUrl, {
			method: 'HEAD',
			headers,
			redirect: 'manual',
			signal: AbortSignal.timeout(5000)
		});

		if (res.status >= 300 && res.status < 400) {
			let location = res.headers.get('Location');
			if (location) {
				// Follow one more redirect if it's to the companion
				if (location.includes('/companion/')) {
					const res2 = await fetch(location, {
						method: 'HEAD',
						redirect: 'manual',
						signal: AbortSignal.timeout(5000)
					});
					if (res2.status >= 300 && res2.status < 400) {
						location = res2.headers.get('Location');
					}
				}
				if (location) {
					// Cache CDN URL for 5 minutes (URLs typically expire in ~6 hours)
					cdnCache.set(cacheKey, { url: location, expires: Date.now() + 5 * 60 * 1000 });
					return location;
				}
			}
		}
	} catch { /* fall through */ }

	return null;
}

export const GET: RequestHandler = async ({ params, url, request, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const { videoId } = params;

	const invConfig = getConfigsForMediaType('video')[0];
	if (!invConfig) return new Response('No Invidious service configured', { status: 404 });

	const userCred = getUserCredentialForService(locals.user.id, invConfig.id) ?? undefined;

	const apiHeaders: Record<string, string> = {};
	if (userCred?.accessToken) apiHeaders['Cookie'] = `SID=${userCred.accessToken}`;

	// Resolve itag — ?muxed=1 forces muxed formats (video+audio, for trailers)
	let itag = url.searchParams.get('itag');
	const muxedOnly = url.searchParams.get('muxed') === '1';
	if (!itag) {
		itag = await resolveBestItag(invConfig.url, videoId, apiHeaders, muxedOnly);
	}
	if (!itag) itag = '18';

	// Resolve CDN URL (cached after first request)
	const cdnUrl = await resolveCdnUrl(invConfig.url, videoId, itag, apiHeaders);

	// Build the fetch URL — either cached CDN or fallback to latest_version with redirect follow
	const fetchUrl = cdnUrl ?? `${invConfig.url}/latest_version?id=${encodeURIComponent(videoId)}&itag=${encodeURIComponent(itag)}`;

	// Forward range headers for seeking
	const proxyHeaders: Record<string, string> = {};
	const rangeHeader = request.headers.get('Range');
	if (rangeHeader) proxyHeaders['Range'] = rangeHeader;

	let upstream: Response;
	try {
		upstream = await fetch(fetchUrl, {
			headers: proxyHeaders,
			redirect: cdnUrl ? 'error' : 'follow' // CDN URL should not redirect
		});
	} catch (e) {
		// If cached CDN URL failed, invalidate and retry
		if (cdnUrl) {
			cdnCache.delete(`${videoId}:${itag}`);
			try {
				upstream = await fetch(
					`${invConfig.url}/latest_version?id=${encodeURIComponent(videoId)}&itag=${encodeURIComponent(itag)}`,
					{ headers: { ...apiHeaders, ...proxyHeaders }, redirect: 'follow' }
				);
			} catch {
				return new Response('Stream unavailable', { status: 502 });
			}
		} else {
			return new Response('Stream unavailable', { status: 502 });
		}
	}

	if (!upstream!.ok && upstream!.status !== 206) {
		await upstream!.body?.cancel().catch(() => {});
		return new Response('Stream error', { status: upstream!.status });
	}

	// Pipe through with proper headers
	const responseHeaders = new Headers();
	responseHeaders.set('Content-Type', upstream!.headers.get('Content-Type') ?? 'video/mp4');
	responseHeaders.set('Accept-Ranges', 'bytes');
	responseHeaders.set('Cache-Control', 'private, max-age=3600');

	const contentLength = upstream!.headers.get('Content-Length');
	if (contentLength) responseHeaders.set('Content-Length', contentLength);
	const contentRange = upstream!.headers.get('Content-Range');
	if (contentRange) responseHeaders.set('Content-Range', contentRange);

	return new Response(upstream!.body, {
		status: upstream!.status,
		headers: responseHeaders
	});
};
