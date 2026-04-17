// CANONICAL: single source for server-boot ordering.
//
// hooks.server.ts calls boot() exactly once at module load. The order here
// matters — preserve it:
//   1. crypto first (NEXUS_ENCRYPTION_KEY validation + undici tuning; nothing
//      else can run without these),
//   2. poller + scheduler (may depend on crypto-decrypted credentials),
//   3. watchdog (observes services that the pollers/schedulers hit),
//   4. proxy (spawns a subprocess; do it after the JS-side is stable),
//   5. lifecycle (social-ws handlers + SIGTERM shutdown handler).
//
// If a future concern needs to boot, add a new module next to the others and
// call it from here. Do not inline boot logic into hooks.server.ts.

import { initCrypto } from './crypto';
import { startPoller } from './poller';
import { startScheduler } from './scheduler';
import { startStreamProxy } from './proxy';
import { startWatchdog } from './watchdog';
import { startLifecycle } from './lifecycle';

let booted = false;

/** Runs the full boot sequence exactly once. Idempotent. */
export function boot(): void {
	if (booted) return;
	initCrypto();
	startPoller();
	startScheduler();
	startWatchdog();
	startStreamProxy();
	startLifecycle();
	booted = true;
}

export { initCrypto, startPoller, startScheduler, startStreamProxy, startWatchdog, startLifecycle };
