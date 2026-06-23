import { createHash } from 'node:crypto';
import { registryV2 } from '$lib/adapters/v2';
import { withStaleCache } from '$lib/server/cache';
import { resolveServiceConfig } from '$lib/server/v2-services';
import type { RequestHandler } from './$types';

const THIRD_PARTY_IMAGE_HOSTS = [
	'yt3.ggpht.com',
	'i.ytimg.com',
	'lh3.googleusercontent.com',
	'image.tmdb.org'
];

const IMAGE_FRESH_MS = 15 * 60 * 1000;
const IMAGE_STALE_MS = 24 * 60 * 60 * 1000;
const IMAGE_NEGATIVE_MS = 5_000;
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

function imageTtl(result: CachedImage): number {
	return result.ok ? IMAGE_FRESH_MS : IMAGE_NEGATIVE_MS;
}

function buildEtag(body: ArrayBuffer): string {
	const hash = createHash('sha1').update(Buffer.from(body)).digest('base64url').slice(0, 16);
	return `W/"${hash}-${body.byteLength}"`;
}

async function fetchImage(url: string, headers: Record<string, string>): Promise<CachedImage> {
	let res: Response;
	try {
		res = await fetch(url, {
			headers,
			signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
			redirect: 'follow'
		});
	} catch {
		return { ok: false, status: 502 };
	}

	if (!res.ok) return { ok: false, status: res.status };

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

function respondFromCache(cached: CachedOk, ifNoneMatch: string | null): Response {
	if (ifNoneMatch && ifNoneMatch === cached.etag) {
		return new Response(null, {
			status: 304,
			headers: {
				ETag: cached.etag,
				'Cache-Control': 'private, max-age=604800, stale-while-revalidate=86400'
			}
		});
	}

	const headers = new Headers();
	headers.set('Content-Type', cached.contentType);
	if (cached.contentLength) headers.set('Content-Length', cached.contentLength);
	if (cached.lastModified) headers.set('Last-Modified', cached.lastModified);
	headers.set('ETag', cached.etag);
	headers.set('Cache-Control', 'private, max-age=604800, stale-while-revalidate=86400');

	return new Response(cached.body.slice(0), { status: 200, headers });
}

export const GET: RequestHandler = async ({ url, request, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const serviceId = url.searchParams.get('service');
	const imagePath = url.searchParams.get('path');
	if (!serviceId || !imagePath) return new Response('Missing service or path', { status: 400 });

	const ifNoneMatch = request.headers.get('If-None-Match');

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

		const cached = await withStaleCache<CachedImage>(
			`media-image:third-party:${imagePath}`,
			imageTtl,
			IMAGE_STALE_MS,
			() => fetchImage(imagePath, {})
		);
		if (!cached.ok) return new Response('Failed to fetch image', { status: 502 });

		const res = respondFromCache(cached, ifNoneMatch);
		if (res.status !== 304) {
			res.headers.set('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
		}
		return res;
	}

	const config = resolveServiceConfig(serviceId);
	if (!config) return new Response('Service not found', { status: 404 });

	const adapter = registryV2.get(config.type);
	const headers = adapter?.getImageHeaders ? await adapter.getImageHeaders(config) : {};
	const imageUrl = `${config.url.replace(/\/+$/, '')}${imagePath}`;
	const cached = await withStaleCache<CachedImage>(
		`media-image:${locals.user.id}:${serviceId}:${imagePath}`,
		imageTtl,
		IMAGE_STALE_MS,
		() => fetchImage(imageUrl, headers)
	);

	if (!cached.ok) {
		return new Response('Failed to fetch image', { status: cached.status === 404 ? 404 : 502 });
	}

	return respondFromCache(cached, ifNoneMatch);
};
