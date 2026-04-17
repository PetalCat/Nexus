// CANONICAL: single source for crypto + outbound-http runtime prerequisites.
//
// Both live here because they share a requirement: they must run before
// anything else boots. NEXUS_ENCRYPTION_KEY validation gates every credential
// read/write (#5, security cluster), and the tuned undici dispatcher must be
// installed before any outbound fetch fires (the image-proxy hot path queues
// on the default 5-connection cap otherwise).
//
// Do not import modules that touch the DB or outbound HTTP from this file —
// that would re-introduce the ordering bug we're preventing.

import { assertEncryptionKey } from '$lib/server/crypto';
import { installTunedDispatcher } from '$lib/server/http-pool';

let initialized = false;

/**
 * Runtime prerequisites. Hard-fails if NEXUS_ENCRYPTION_KEY is absent or
 * malformed. Also installs the tuned undici dispatcher. Idempotent.
 */
export function initCrypto(): void {
	if (initialized) return;
	assertEncryptionKey();
	installTunedDispatcher();
	initialized = true;
}
