import { createHash } from 'node:crypto';
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
	'image.tmdb.org'
];

/** Positive cache window (fresh). */
const IMAGE_FRESH_MS = 15 * 60 * 1000;
/** Stale-while-revalidate window on top of fresh. */
const IMAGE_STALE_MS = 24 * 60 * 60 * 1000;
/** Negative cache window — short so a flaky/404 upstream recovers quickly. */
const IMAGE_NEGATIVE_MS = 5_000;
/** Upstream fetch timeout. */
const UPSTREAM_TIMEOUT_MS = 20_000;

type CachedOk = {
	ok: true;
	body: ArrayBuffer;
	contentType: string;
	contentLength: string | null;
	lastModified: string | null;
	etag: string;
};
type CachedErr = { ok: false; status: number };
type CachedImage = CachedOk | CachedErr;

/** Choose TTL: long for hits, short for negatives, so upstream 404s don't
 *  poison the cache for 24h but transient flaps don't spam upstream either. */
function imageTtl(result: CachedImage): number {
	return result.ok ? IMAGE_FRESH_MS : IMAGE_NEGATIVE_MS;
}

/** Build a weak ETag from the body bytes. Weak because we're proxying and
 *  don't need byte-perfect semantics — we just need stability so If-None-Match
 *  can hit 304. */
function buildEtag(body: ArrayBuffer): string {
	const hash = createHash('sha1').update(Buffer.from(body)).digest('base64url').slice(0, 16);
	return `W/"${hash}-${body.byteLength}"`;
}

async function fetchImage(
	url: string,
	headers: Record<string, string>
): Promise<CachedImage> {
	let res: Response;
	try {
		res = await fetch(url, {
			headers,
			signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
			redirect: 'follow'
		});
	} catch {
		// Network error / timeout — briefly cache as a 502 so concurrent callers
		// don't each wait 20s before failing.
		return { ok: false, status: 502 };
	}

	if (!res.ok) {
		return { ok: false, status: res.status };
	}

	const body = await res.arrayBuffer();
	return {
		ok: true,
		body,
		contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
		contentLength: res.headers.get('Content-Length'),
		lastModified: res.headers.get('Last-Modified'),
		etag: buildEtag(body)
	};
}

/** Build a 200 response from a cached hit, honoring If-None-Match for 304. */
function respondFromCache(cached: CachedOk, ifNoneMatch: string | null): Response {
	if (ifNoneMatch && ifNoneMatch === cached.etag) {
		// Client still has a valid copy — save the body roundtrip entirely.
		return new Response(null, {
			status: 304,
			headers: {
				ETag: cached.etag,
				'Cache-Control': 'private, max-age=604800, stale-while-revalidate=86400'
			}
		});
	}

	const responseHeaders = new Headers();
	responseHeaders.set('Content-Type', cached.contentType);
	if (cached.contentLength) responseHeaders.set('Content-Length', cached.contentLength);
	if (cached.lastModified) responseHeaders.set('Last-Modified', cached.lastModified);
	responseHeaders.set('ETag', cached.etag);
	responseHeaders.set('Cache-Control', 'private, max-age=604800, stale-while-revalidate=86400');

	// `slice(0)` returns a fresh ArrayBuffer — required because Response
	// marks the underlying buffer as "used" once consumed, and the cache
	// entry is shared across concurrent responses.
	return new Response(cached.body.slice(0), { status: 200, headers: responseHeaders });
}

/**
 * Image proxy — fetches images from backend services that require auth
 * (RomM, Calibre-Web, etc.) and returns them to the browser.
 *
 * Hot path. See `src/lib/server/http-pool.ts` for upstream connection tuning
 * and `src/lib/server/cache.ts` for the stale-while-revalidate + inflight
 * dedupe that prevents thundering herds on cache miss.
 *
 * Query params:
 *   service — service ID
 *   path    — path on the service (e.g. /assets/romm/resources/roms/.../cover/big.jpeg)
 *              OR an absolute URL on an allowlisted third-party host.
 */
export const GET: RequestHandler = async ({ url, request, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const serviceId = url.searchParams.get('service');
	const imagePath = url.searchParams.get('path');

	if (!serviceId || !imagePath) {
		return new Response('Missing service or path', { status: 400 });
	}

	const ifNoneMatch = request.headers.get('If-None-Match');

	// Third-party absolute URL path — no service auth needed, just validate
	// the host is on the allowlist and proxy the bytes.
	if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
		let parsed: URL;
		try {
			parsed = new URL(imagePath);
		} catch {
			return new Response('Invalid URL', { status: 400 });
		}
		if (!THIRD_PARTY_IMAGE_HOSTS.includes(parsed.hostname)) {
			return new Response('Host not allowlisted', { status: 403 });
		}

		const cacheKey = `media-image:third-party:${imagePath}`;
		const cached = await withStaleCache<CachedImage>(
			cacheKey,
			imageTtl,
			IMAGE_STALE_MS,
			() => fetchImage(imagePath, {})
		);

		if (!cached.ok) {
			return new Response('Failed to fetch image', { status: 502 });
		}
		// Third-party hosts allow public caching.
		const res = respondFromCache(cached, ifNoneMatch);
		if (res.status !== 304) {
			res.headers.set('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
		}
		return res;
	}

	const config = getServiceConfig(serviceId);
	if (!config) return new Response('Service not found', { status: 404 });

	const adapter = registry.get(config.type);
	const userCred =
		locals.user?.id && adapter?.userLinkable
			? (getUserCredentialForService(locals.user.id, serviceId) ?? undefined)
			: undefined;

	// Build auth headers via adapter method (falls back to generic token if not implemented).
	// This runs per request but is cheap (just string/base64 work) — not worth caching.
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

	const cached = await withStaleCache<CachedImage>(
		cacheKey,
		imageTtl,
		IMAGE_STALE_MS,
		() => fetchImage(imageUrl, headers)
	);

	if (!cached.ok) {
		return new Response('Failed to fetch image', { status: cached.status === 404 ? 404 : 502 });
	}

	return respondFromCache(cached, ifNoneMatch);
};
