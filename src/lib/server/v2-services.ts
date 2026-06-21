/**
 * Phase-0 service-config shim for the v2 adapters.
 *
 * The real source of truth will be a `services` DB row per backend. Until that
 * lands, the negotiate seam needs SOMETHING to hand the adapter as its single
 * service `config`. For Jellyfin we read the install cred from env:
 *
 *   NEXUS_JELLYFIN_URL      e.g. http://127.0.0.1:8096
 *   NEXUS_JELLYFIN_APIKEY   the dashboard API key (no expiry, no device slot)
 *
 * A tiny shim — deliberately not a registry. `resolveServiceConfig(backend)`
 * returns a ServiceConfig the adapter can use, or null if the backend isn't
 * configured (the caller 404s).
 */

import type { ServiceConfig } from '$lib/adapters/types';
import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema } from '../db';

/** Oldest enabled service of a given type from the DB-backed services table.
 *  Deterministic tiebreak by createdAt so a duplicate-type config can't make
 *  playback non-deterministically pick a different credential across writes. */
function serviceFromDb(type: string): ServiceConfig | null {
	const row = getDb()
		.select()
		.from(schema.services)
		.where(and(eq(schema.services.type, type), eq(schema.services.enabled, true)))
		.orderBy(asc(schema.services.createdAt))
		.get();
	return (row as ServiceConfig | undefined) ?? null;
}

/** Build a Jellyfin ServiceConfig from env, or null when not configured. */
function jellyfinFromEnv(): ServiceConfig | null {
	const url = process.env.NEXUS_JELLYFIN_URL;
	const apiKey = process.env.NEXUS_JELLYFIN_APIKEY;
	if (!url || !apiKey) return null;
	return {
		id: 'jellyfin',
		name: 'Jellyfin',
		type: 'jellyfin',
		url: url.replace(/\/+$/, ''),
		apiKey,
		enabled: true
	};
}

/** Build an Invidious ServiceConfig from env, or null when not configured.
 *  Anonymous (public content) — only the instance URL is needed. */
function invidiousFromEnv(): ServiceConfig | null {
	const url = process.env.NEXUS_INVIDIOUS_URL;
	if (!url) return null;
	return {
		id: 'invidious',
		name: 'Invidious',
		type: 'invidious',
		url: url.replace(/\/+$/, ''),
		enabled: true
	};
}

/**
 * Resolve the single service config for a v2 backend id. Phase-0: env-backed.
 * Returns null if the backend isn't configured.
 */
export function resolveServiceConfig(backend: string): ServiceConfig | null {
	// The DB-backed services table is the source of truth (seeded from env on boot
	// for jellyfin/invidious — see boot/seed-services.ts), so admin edits in the UI
	// take effect. The env shim is only a fallback for installs that haven't seeded
	// a row yet.
	const fromDb = serviceFromDb(backend);
	if (fromDb) return fromDb;
	switch (backend) {
		case 'jellyfin':
			return jellyfinFromEnv();
		case 'invidious':
			return invidiousFromEnv();
	}
	return null;
}
