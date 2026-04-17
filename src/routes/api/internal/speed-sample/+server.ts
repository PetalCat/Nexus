import type { RequestHandler } from './$types';

/**
 * Speed-probe endpoint. Returns a fixed 1 MB stream of pseudo-random bytes
 * so the client can measure browser↔Nexus throughput without the upstream
 * media server in the path.
 *
 * - Body is generated chunk-by-chunk so we never allocate the full 1 MB at
 *   once. ReadableStream pumps 64 KB chunks through the socket.
 * - Content is pseudo-random (per-chunk salt rotated by a PRNG) so any
 *   transparent gzip/brotli middlebox sees incompressible bytes and can't
 *   under-report transfer time.
 * - Cache-Control forbids re-use so the probe measures a fresh fetch.
 */

const TOTAL_BYTES = 1024 * 1024; // 1 MB
const CHUNK_SIZE = 64 * 1024; // 64 KB

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	let sent = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent >= TOTAL_BYTES) {
				controller.close();
				return;
			}
			const size = Math.min(CHUNK_SIZE, TOTAL_BYTES - sent);
			const chunk = new Uint8Array(size);
			// crypto.getRandomValues is available in the Node 22 runtime (via
			// Web Crypto). It fills `size` bytes in one syscall — cheap.
			crypto.getRandomValues(chunk);
			controller.enqueue(chunk);
			sent += size;
		},
	});

	return new Response(stream, {
		status: 200,
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Length': String(TOTAL_BYTES),
			'Cache-Control': 'no-store, no-cache, must-revalidate',
			'Content-Encoding': 'identity',
		},
	});
};
