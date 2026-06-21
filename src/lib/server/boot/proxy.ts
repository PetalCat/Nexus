// CANONICAL: single source for the Rust stream-proxy subprocess lifecycle.
//
// The stream-proxy is always started — its Jellyfin HLS session-handoff path
// works regardless of whether Invidious is configured, and the Invidious
// features are dormant when no Invidious service is set up. The Invidious URL
// is passed in when available so Invidious-bound streams can be served if a
// service is configured later.

import { startStreamProxy as startStreamProxyImpl } from '$lib/server/stream-proxy';
import { getEnabledConfigs } from '$lib/server/services';

let started = false;

/**
 * Starts the Rust stream-proxy subprocess. Idempotent. The proxy is process-
 * level; stopStreamProxy is exposed for tests/teardown but the normal app
 * lifecycle lets SIGTERM clean up the child.
 */
export function startStreamProxy(): void {
	if (started) return;
	const invConfig = getEnabledConfigs().find((c) => c.type === 'invidious');
	// Phase-0 env shim (mirrors resolveServiceConfig): the Invidious instance URL
	// comes from NEXUS_INVIDIOUS_URL. Used both as the legacy /v fallback base AND
	// as a held cred for the `invidious` backend so the v2 DASH/seg grant routes
	// (`/v/{id}/dash`, `/v/{id}/seg/...`) resolve the real instance. Invidious is
	// public, so no auth header is injected (empty name/value).
	const invidiousUrl =
		process.env.NEXUS_INVIDIOUS_URL ?? invConfig?.url ?? 'http://localhost:3000';
	const heldCreds = process.env.NEXUS_INVIDIOUS_URL
		? {
				invidious: {
					base_url: process.env.NEXUS_INVIDIOUS_URL.replace(/\/+$/, ''),
					auth_header_name: '',
					auth_header_value: ''
				}
			}
		: {};
	startStreamProxyImpl({
		invidiousUrl,
		heldCreds,
		streamSecret: process.env.NEXUS_STREAM_SECRET,
	});
	started = true;
}
