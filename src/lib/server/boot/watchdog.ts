// CANONICAL: single source for health-watchdog + service-recovery fanout.
//
// The watchdog detects when a previously-failing service comes back online
// and fires a recovery event. We subscribe here to broadcast the recovery to
// every connected WS client so their caches get invalidated.

import { startHealthWatchdog, onServiceRecovery } from '$lib/server/health-watchdog';
import { broadcastToAll } from '$lib/server/ws';

let started = false;

/** Starts the health watchdog and wires service-recovery broadcasts. Idempotent. */
export function startWatchdog(): void {
	if (started) return;
	startHealthWatchdog();
	onServiceRecovery((recoveredIds) => {
		broadcastToAll({
			type: 'services:recovered',
			data: { serviceIds: recoveredIds }
		});
	});
	started = true;
}
