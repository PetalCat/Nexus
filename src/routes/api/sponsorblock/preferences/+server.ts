import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { sponsorblockPreferences } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/** GET: Fetch current user's SponsorBlock preferences */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();
	const pref = db.select().from(sponsorblockPreferences)
		.where(eq(sponsorblockPreferences.userId, locals.user.id))
		.get();

	if (!pref) {
		// Return defaults (not yet saved). showOnTimeline removed 2026-04-17
		// — no scrub-bar consumer ships; see codex-review/27 bug A.
		return json({
			enabled: true,
			categorySettings: {
				sponsor: 'skip', selfpromo: 'skip', interaction: 'skip',
				intro: 'off', outro: 'off', preview: 'off',
				music_offtopic: 'off', filler: 'off',
				poi_highlight: 'show', chapter: 'off'
			},
			showSkipNotice: true,
			skipNoticeDuration: 3000
		});
	}

	return json({
		enabled: pref.enabled,
		categorySettings: JSON.parse(pref.categorySettings),
		showSkipNotice: pref.showSkipNotice,
		skipNoticeDuration: pref.skipNoticeDuration
	});
};

/** PUT: Update SponsorBlock preferences */
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);

	const body = await request.json();
	const db = getDb();
	const userId = locals.user.id;
	const now = Date.now();

	const existing = db.select().from(sponsorblockPreferences)
		.where(eq(sponsorblockPreferences.userId, userId))
		.get();

	const values = {
		enabled: body.enabled ?? true,
		categorySettings: typeof body.categorySettings === 'string'
			? body.categorySettings
			: JSON.stringify(body.categorySettings ?? {}),
		// showOnTimeline removed 2026-04-17 — no reader, no UI.
		showSkipNotice: body.showSkipNotice ?? true,
		skipNoticeDuration: body.skipNoticeDuration ?? 3000,
		updatedAt: now
	};

	if (existing) {
		db.update(sponsorblockPreferences).set(values)
			.where(eq(sponsorblockPreferences.id, existing.id)).run();
	} else {
		db.insert(sponsorblockPreferences).values({ userId, ...values }).run();
	}

	return json({ ok: true });
};
