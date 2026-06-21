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
	// Env shim keeps precedence for the Phase-0 jellyfin/invidious installs (so
	// their existing env-based config is unchanged), then fall back to the
	// DB-backed services table by type. This lets DB-registered backends (Plex,
	// and jellyfin/invidious once migrated off env) resolve — a step toward
	// making the services table the single source of truth (#2).
	switch (backend) {
		case 'jellyfin': {
			const env = jellyfinFromEnv();
			if (env) return env;
			break;
		}
		case 'invidious': {
			const env = invidiousFromEnv();
			if (env) return env;
			break;
		}
	}
	return serviceFromDb(backend);
}
