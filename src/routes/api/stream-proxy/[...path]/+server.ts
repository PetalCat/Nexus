import type { RequestHandler } from './$types';

/**
 * Reverse-proxy to the local Rust stream-proxy binary at 127.0.0.1:3939.
 *
 * The Rust binary listens on localhost and is not directly reachable by
 * browsers (especially in Docker deployments where port 3939 isn't exposed).
 * This route handler forwards requests through the SvelteKit origin so the
 * browser only ever talks to Nexus.
 *
 * The Rust side handles HMAC verification, session lookup, HLS manifest
 * rewriting, and ApiKey stripping. This handler just pipes bytes.
 *
 * URL shape: `/api/stream-proxy/{session_id}[/{suffix}]?sig=...`
 * Upstream:  `http://127.0.0.1:3939/stream/{session_id}[/{suffix}]?sig=...`
 */
const RUST_PROXY_ORIGIN = 'http://127.0.0.1:3939';

export const GET: RequestHandler = async ({ params, url, request }) => {
	const upstreamPath = `/stream/${params.path}`;
	const upstreamUrl = `${RUST_PROXY_ORIGIN}${upstreamPath}${url.search}`;

	// Forward Range header for seekable media requests
	const headers: Record<string, string> = {};
	const range = request.headers.get('range');
	if (range) headers['range'] = range;

	let upstream: Response;
	try {
		upstream = await fetch(upstreamUrl, {
			method: 'GET',
			headers,
			// Rust proxy can take a while for large upstream fetches; don't timeout.
			signal: request.signal
		});
	} catch (e) {
		console.warn('[stream-proxy-reverse] fetch error:', e);
		return new Response('stream proxy unavailable', { status: 502 });
	}

	// Pass through status, selected headers, and body (streaming).
	const responseHeaders = new Headers();
	const passthroughHeaders = [
		'content-type',
		'content-length',
		'content-range',
		'accept-ranges',
		'etag',
		'last-modified',
		'cache-control'
	];
	for (const name of passthroughHeaders) {
		const value = upstream.headers.get(name);
		if (value !== null) responseHeaders.set(name, value);
	}

	return new Response(upstream.body, {
		status: upstream.status,
		headers: responseHeaders
	});
};

export const HEAD: RequestHandler = async (event) => {
	// HEAD requests reuse the GET handler (same upstream semantics).
	return GET(event);
};
