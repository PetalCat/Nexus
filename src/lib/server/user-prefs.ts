import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';

// CANONICAL: single reader for app_settings-backed user preferences.
//
// Storage lives in `app_settings` as key-value pairs keyed
// `user:<userId>:<prefKey>`. The writer is the POST handler in
// src/routes/api/user/settings/+server.ts; the `ALLOWED_KEYS` allowlist
// there MUST stay in sync with the reader functions below.
//
// Every consumer reads through these helpers — no inline
// `db.select()...from(appSettings)` reads of user preferences elsewhere.
// That's the whole point: one place where the default + coercion rules
// for each preference live, so readers cannot silently disagree.
//
// Consumed by: see `// Consumed by:` comments on each helper.
//
// Added 2026-04-17 (#34, codex-review/27 bug C).

function readBoolPref(userId: string, prefKey: string, fallback: boolean): boolean {
	const db = getDb();
	const row = db
		.select({ value: schema.appSettings.value })
		.from(schema.appSettings)
		.where(eq(schema.appSettings.key, `user:${userId}:${prefKey}`))
		.get();
	if (!row) return fallback;
	return row.value === 'true';
}

/**
 * Hero-carousel trailer autoplay preference.
 *
 * Default: `true` on the server (desktop). Mobile clients override to
 * `false` on their own — that's a client-side signal, not a stored pref.
 *
 * Consumed by:
 * - src/routes/+layout.server.ts → exposes as `autoplayTrailers` on root
 *   layout data; pages consume via `data.autoplayTrailers`
 * - src/routes/settings/playback/+page.svelte → reads via layout data for
 *   the toggle's initial state
 */
export function getAutoplayTrailers(userId: string): boolean {
	return readBoolPref(userId, 'autoplayTrailers', true);
}

/**
 * Auto-advance to the next item when a playback session ends.
 *
 * Default: `false` (opt-in — see playback alignment plan #20).
 *
 * Consumed by:
 * - src/routes/+layout.server.ts → exposes as `autoplayNext` on root
 *   layout data (currently used by the settings page for the toggle
 *   initial state)
 * - src/routes/media/[type]/[id]/+page.server.ts → embeds in
 *   `playbackPrefs.autoplayNext` so the NexusPlayer component can
 *   decide whether to fire `onplaynext` at `ended`
 * - src/lib/components/player/NexusPlayer.svelte → receives as an
 *   `autoplayNext` prop (via `playbackPrefs`); does NOT read storage
 *   itself
 */
export function getAutoplayNext(userId: string): boolean {
	return readBoolPref(userId, 'autoplayNext', false);
}
