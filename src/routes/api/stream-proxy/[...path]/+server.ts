import type { RequestHandler } from './$types';

/**
 * Reverse-proxy to the local Rust stream-proxy binary at 127.0.0.1:3939 — the
 * enforcement seam.
 *
 * The Rust binary listens on loopback and is NOT directly reachable by browsers
 * (in Docker, 3939 isn't exposed). This handler forwards through the SvelteKit
 * origin so the browser only ever talks to Nexus. The grant rides in the URL
 * query (`?grant=<paseto>`); the Rust side verifies it, resolves the held
 * service cred, strips/injects auth, and rewrites HLS manifests. This handler is
 * deliberately thin: path-preserving forward + Range passthrough + status/header
 * passthrough + streaming body.
 *
 * URL shape (v2 grant):   /api/stream-proxy/stream?grant=<token>[&suffix=<hex>]
 *                      →  http://127.0.0.1:3939/stream?grant=<token>[&suffix=<hex>]
 * Legacy Invidious /v/…:  /api/stream-proxy/v/{id}/...?grant=<token>
 *                      →  http://127.0.0.1:3939/v/{id}/...?grant=<token>
 */
const RUST_PROXY_ORIGIN = 'http://127.0.0.1:3939';

const PASSTHROUGH_HEADERS = [
	'content-type',
	'content-length',
	'content-range',
	'accept-ranges',
	'etag',
	'last-modified',
	'cache-control'
];

export const GET: RequestHandler = async ({ params, url, request, locals }) => {
	// Enforcement seam: the grant is session-bound. Require an authenticated Nexus
	// session and stamp the user id so the Rust proxy can verify it against the
	// grant's user_id — the copy-paste / replay defense. A grant URL pasted into
	// another browser (no session, or a different user's session) fails here or at
	// the proxy's X-Nexus-User check.
	if (!locals.user) return new Response('Unauthorized', { status: 403 });

	// Path-preserving forward: `/api/stream-proxy/<path>` → `/<path>` on the Rust
	// binary, carrying the query string verbatim (the grant lives there).
	const path = params.path ?? '';
	const upstreamUrl = `${RUST_PROXY_ORIGIN}/${path}${url.search}`;

	const headers: Record<string, string> = { 'x-nexus-user': locals.user.id };
	const range = request.headers.get('range');
	if (range) headers['range'] = range;

	let upstream: Response;
	try {
		upstream = await fetch(upstreamUrl, {
			method: 'GET',
			headers,
			// Large upstream fetches can be slow; tie the lifetime to the client.
			signal: request.signal
		});
	} catch (e) {
		console.warn('[stream-proxy-reverse] fetch error:', e);
		return new Response('stream proxy unavailable', { status: 502 });
	}

	const responseHeaders = new Headers();
	for (const name of PASSTHROUGH_HEADERS) {
		const value = upstream.headers.get(name);
		if (value !== null) responseHeaders.set(name, value);
	}

	return new Response(upstream.body, {
		status: upstream.status,
		headers: responseHeaders
	});
};

export const HEAD: RequestHandler = async (event) => GET(event);
