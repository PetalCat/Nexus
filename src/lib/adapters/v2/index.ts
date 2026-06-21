/**
 * v2 adapter registration.
 *
 * Importing this module registers every concrete v2 adapter onto the singleton
 * registry, running each through the conformance gate (register() THROWS on a
 * hard failure — a non-conformant adapter crashes here, not silently at
 * runtime). Routes import `{ registryV2 }` from here so the side-effecting
 * registration has run before they look an adapter up.
 */

import { registryV2 } from './registry';
import { jellyfinV2 } from './jellyfin';

let registered = false;

/** Idempotently register all v2 adapters. Safe to call from any seam. */
export function registerV2Adapters(): void {
	if (registered) return;
	registryV2.register(jellyfinV2);
	registered = true;
}

// Register on first import so a bare `import './v2'` is enough.
registerV2Adapters();

export { registryV2 };
