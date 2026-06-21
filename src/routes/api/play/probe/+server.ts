import type { RequestHandler } from './$types';

/**
 * GET /api/play/probe?bytes=N — bandwidth probe.
 *
 * Streams N bytes of incompressible data so the client can measure its real
 * download throughput (time the full download → bits/sec) and pass it to
 * /negotiate as measuredBandwidthBps. The adapter then picks the right rendition
 * up front (direct-play when the source fits, transcode-down only when it
 * doesn't) — the "smart bitrate" lever that avoids the rough quality switches.
 *
 * Incompressible payload + Cache-Control: no-store so a CDN/proxy/gzip can't
 * skew the measurement. Capped to keep it cheap.
 */
const DEFAULT_BYTES = 4_000_000;
const MAX_BYTES = 16_000_000;
const CHUNK = 64 * 1024;

// A fixed pseudo-random (incompressible) chunk, generated once.
const seed = new Uint8Array(CHUNK);
for (let i = 0; i < CHUNK; i++) seed[i] = (i * 2654435761) & 0xff;

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	const requested = Number(url.searchParams.get('bytes')) || DEFAULT_BYTES;
	const total = Math.min(Math.max(requested, CHUNK), MAX_BYTES);

	let sent = 0;
	const stream = new ReadableStream({
		pull(controller) {
			if (sent >= total) {
				controller.close();
				return;
			}
			const n = Math.min(CHUNK, total - sent);
			controller.enqueue(n === CHUNK ? seed : seed.subarray(0, n));
			sent += n;
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'application/octet-stream',
			'content-length': String(total),
			'cache-control': 'no-store, no-transform'
		}
	});
};
