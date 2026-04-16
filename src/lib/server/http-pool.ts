/**
 * Tuned undici dispatcher for outbound HTTP to upstream services.
 *
 * Node's global fetch uses undici, which defaults to ~5 connections per
 * origin with modest keep-alive timeouts. On the image-proxy hot path the
 * browser fires 40+ parallel requests at Nexus, and each one turns into a
 * round trip to Jellyfin/Plex/etc. With 5-per-origin, those 40 requests
 * serialize 5-at-a-time, which is the main contributor to p50 latency on
 * high-RTT links (~3 s observed on a 420 ms WAN link).
 *
 * Raising `connections` per origin + longer keep-alive flattens that
 * serialization. The dispatcher is installed globally so every `fetch()`
 * in the process picks it up.
 */
import { Agent, setGlobalDispatcher } from 'undici';

let installed = false;

export function installTunedDispatcher(): void {
	if (installed) return;
	installed = true;

	const agent = new Agent({
		// Max concurrent TCP connections per origin. Default is 5; at 32 we
		// can saturate upstream on a poster-wall page without queuing.
		connections: 32,
		// Keep sockets warm between requests so we don't pay TLS handshake
		// on every image.
		keepAliveTimeout: 30_000,
		keepAliveMaxTimeout: 10 * 60_000,
		// Pipelining helps when upstream supports it (HTTP/1.1). Safe default
		// of 1 if upstream mis-behaves.
		pipelining: 1,
		// Let upstream send us whatever; we relay.
		headersTimeout: 20_000,
		bodyTimeout: 30_000
	});

	setGlobalDispatcher(agent);
}
