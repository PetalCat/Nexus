// CANONICAL: single source for application-level eventing + shutdown lifecycle.
//
// Two concerns bundled:
//   - social-ws event handler registration (subscribes to internal events so
//     they're fanned out to connected clients),
//   - SIGTERM/SIGINT graceful shutdown handler registration.
// Both are process-wide and only meaningful after the other background
// services have booted, so they run last in the boot sequence.

import { initSocialWsHandlers } from '$lib/server/social-ws';
import { registerShutdownHandler } from '$lib/server/shutdown';

let started = false;

/** Registers application-level lifecycle handlers. Idempotent. */
export function startLifecycle(): void {
	if (started) return;
	initSocialWsHandlers();
	registerShutdownHandler();
	started = true;
}
