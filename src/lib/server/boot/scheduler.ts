// CANONICAL: single source for background job scheduling.
//
// Scheduling concerns: daily/periodic analytic aggregations (stats-scheduler)
// and recommendation-engine refresh (rec-scheduler). Both run on fixed cadence
// and depend on crypto-decrypted credentials being available — so they boot
// strictly after initCrypto().

import { startStatsScheduler } from '$lib/server/stats-scheduler';
import { startRecScheduler } from '$lib/server/rec-scheduler';

let started = false;

/** Starts all module-owned background schedulers. Idempotent. */
export function startScheduler(): void {
	if (started) return;
	startStatsScheduler();
	startRecScheduler();
	started = true;
}
