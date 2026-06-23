import type { RequestHandler } from './$types';
import { getProxyAuthSecret } from '$lib/server/stream-proxy';

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
	// Transparent-proxy correctness: the Rust proxy forwards the upstream body
	// bytes verbatim (still gzip/br-encoded when the upstream compressed them).
	// Without forwarding content-encoding the browser sees compressed bytes
	// labelled as plain text and parses garbage (caught: gzipped WebVTT → 0 cues).
	'content-encoding',
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

	const path = params.path ?? '';

	// HARD ALLOWLIST (adversarial review: the Rust binary still carries legacy
	// UNGATED routes — `/proxy?url=` (open-proxy SSRF into the LAN/loopback),
	// `/stream/{id}`, `/stats`. A path-preserving forward exposed all of them to
	// any logged-in user. Only the grant-bound v2 routes may pass:
	//   stream            (Jellyfin/inline:  /stream?grant=…)
	//   v/{id}, v/{id}/…  (Invidious:        /v/{id}/dash|seg/…|captions?grant=…)
	// and EVERY forwarded request MUST carry a ?grant= (the actual authority).
	// TRAVERSAL/ENCODING GUARD (adversarial review of the allowlist itself): the
	// allowlist sees the DECODED path, but the upstream is built as a string that
	// fetch() re-normalizes — so `v%2f..%2fproxy` (or a literal `..`) would collapse
	// to `/proxy` and reach the ungated SSRF route AFTER passing the seg0 check.
	// Reject any path with a `..`/`.` segment, an empty segment, or a stray `%`
	// (no smuggled encoded slashes), so the path that's checked == the path that's
	// forwarded == the path the Rust proxy routes on.
	const segs = path.split('/');
	const cleanPath =
		!path.includes('%') && segs.every((s) => s.length > 0 && s !== '.' && s !== '..');
	const seg0 = segs[0];
	const allowed = path === 'stream' || seg0 === 'v';
	if (!cleanPath || !allowed || !url.searchParams.has('grant')) {
		return new Response('Forbidden', { status: 403 });
	}

	// Path-preserving forward of the now-clean, allowlisted path (no `..` left for
	// fetch to normalize), carrying the query string verbatim (the grant lives there).
	const upstreamUrl = `${RUST_PROXY_ORIGIN}/${path}${url.search}`;

	const headers: Record<string, string> = { 'x-nexus-user': locals.user.id };
	// Authenticate to the Rust proxy with the per-boot shared secret so it never
	// trusts an x-nexus-user that didn't come through this seam.
	const proxyAuth = getProxyAuthSecret();
	if (proxyAuth) headers['x-nexus-proxy-auth'] = proxyAuth;
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
