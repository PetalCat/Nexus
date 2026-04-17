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
	startStreamProxyImpl(invConfig?.url ?? 'http://localhost:3000');
	started = true;
}
