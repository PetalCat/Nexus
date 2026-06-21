import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../db';

/**
 * One-time bootstrap seed: if Jellyfin/Invidious are configured via the Phase-0
 * env shim but have no row in the `services` table yet, create one so the DB is
 * the single source of truth (and the service is editable in the admin UI).
 *
 * Idempotent — only inserts when no service of that type exists, so admin edits
 * (or a later delete) are not clobbered on the next boot. The env vars remain a
 * fallback in resolveServiceConfig for installs that haven't seeded yet.
 */
export function seedServicesFromEnv(): void {
	const db = getDb();
	const hasType = (type: string): boolean =>
		!!db.select().from(schema.services).where(eq(schema.services.type, type)).get();

	const jfUrl = process.env.NEXUS_JELLYFIN_URL;
	const jfKey = process.env.NEXUS_JELLYFIN_APIKEY;
	if (jfUrl && jfKey && !hasType('jellyfin')) {
		db.insert(schema.services)
			.values({
				id: `jellyfin-${randomBytes(3).toString('hex')}`,
				name: 'Jellyfin',
				type: 'jellyfin',
				url: jfUrl.replace(/\/+$/, ''),
				apiKey: jfKey,
				enabled: true
			})
			.run();
		console.log('[seed] Created jellyfin service row from env shim');
	}

	const invUrl = process.env.NEXUS_INVIDIOUS_URL;
	if (invUrl && !hasType('invidious')) {
		db.insert(schema.services)
			.values({
				id: `invidious-${randomBytes(3).toString('hex')}`,
				name: 'Invidious',
				type: 'invidious',
				url: invUrl.replace(/\/+$/, ''),
				enabled: true
			})
			.run();
		console.log('[seed] Created invidious service row from env shim');
	}
}
