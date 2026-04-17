import { json, error } from '@sveltejs/kit';
import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// STORAGE: the canonical writer for app_settings-backed user preferences.
// Keys stored here as `user:<userId>:<key>` are read ONLY through the helpers
// in $lib/server/user-prefs — no other reader should hit app_settings directly
// for these values (enforced by review discipline, not a lint rule).
//
// Consumed by:
// - autoplayTrailers → getAutoplayTrailers() in $lib/server/user-prefs.ts
//     • src/routes/+layout.server.ts (root layout data)
//     • src/routes/settings/playback/+page.svelte (toggle initial state)
// - autoplayNext → getAutoplayNext() in $lib/server/user-prefs.ts
//     • src/routes/+layout.server.ts (root layout data)
//     • src/routes/media/[type]/[id]/+page.server.ts (playbackPrefs payload
//       that NexusPlayer consumes at playback end)
//     • src/routes/settings/playback/+page.svelte (toggle initial state)
//
// Keep this allowlist in sync with the helper functions in user-prefs.ts.
// (#34, codex-review/27 bug C.)
const ALLOWED_KEYS = ['autoplayTrailers', 'autoplayNext'];

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);
	const { key, value } = await request.json();
	if (!ALLOWED_KEYS.includes(key)) throw error(400, 'Invalid setting key');

	const db = getDb();
	const fullKey = `user:${locals.user.id}:${key}`;

	const existing = db
		.select()
		.from(schema.appSettings)
		.where(eq(schema.appSettings.key, fullKey))
		.get();

	if (existing) {
		db.update(schema.appSettings)
			.set({ value: String(value) })
			.where(eq(schema.appSettings.key, fullKey))
			.run();
	} else {
		db.insert(schema.appSettings)
			.values({ key: fullKey, value: String(value) })
			.run();
	}

	return json({ ok: true });
};
