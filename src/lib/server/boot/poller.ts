// CANONICAL: single source for session/polling background loops.
//
// Polling concerns: session validity sweeps and video-notification fanout.
// Both start interval timers; if teardown becomes needed, add stop* exports
// that mirror start*. Today the app runs until the process exits, so the
// pollers deliberately have no public stop hook.

import { startSessionPoller } from '$lib/server/session-poller';
import { startVideoNotificationPoller } from '$lib/server/video-notifications';

let started = false;

/** Starts all module-owned polling loops. Idempotent. */
export function startPoller(): void {
	if (started) return;
	startSessionPoller();
	startVideoNotificationPoller();
	started = true;
}
