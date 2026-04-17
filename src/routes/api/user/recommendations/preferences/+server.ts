import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import {
	DEFAULT_PROFILE,
	RecProfileConfigSchema,
	parseRecProfileConfig
} from '$lib/server/recommendations/types';
import { invalidatePrefix } from '$lib/server/cache';
import { invalidateHomepageCache } from '$lib/server/homepage-cache';
import type { RequestHandler } from './$types';

/**
 * CANONICAL: `/api/user/recommendations/preferences` — the one endpoint for the
 * RecProfileConfig tuning blob. GET returns `{ profile, defaultProfile, hiddenItems }`,
 * PUT validates via zod and writes the default profile row. The legacy alias at
 * `/api/recommendations/preferences` was removed in the apr17 consolidation (#33).
 */

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const raw = getRawDb();
	const row = raw.prepare(
		`SELECT config FROM user_rec_profiles WHERE user_id = ? AND is_default = 1 LIMIT 1`
	).get(user.id) as { config: string } | undefined;

	const profile = parseRecProfileConfig(row?.config);

	const hidden = raw.prepare(
		`SELECT media_id, reason, created_at FROM user_hidden_items WHERE user_id = ? ORDER BY created_at DESC`
	).all(user.id) as Array<{ media_id: string; reason: string | null; created_at: number }>;

	return json({ profile, defaultProfile: DEFAULT_PROFILE, hiddenItems: hidden });
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const parsed = RecProfileConfigSchema.safeParse(body);
	if (!parsed.success) {
		return json(
			{ error: 'Invalid RecProfileConfig', issues: parsed.error.issues },
			{ status: 400 }
		);
	}

	const raw = getRawDb();
	const now = Date.now();

	raw.prepare(
		`INSERT INTO user_rec_profiles (id, user_id, name, is_default, config, created_at, updated_at)
		 VALUES (?, ?, 'Default', 1, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`
	).run(
		`default:${user.id}`,
		user.id,
		JSON.stringify(parsed.data),
		now,
		now
	);

	invalidatePrefix(`rec-rows:${user.id}`);
	invalidateHomepageCache(user.id);

	return json({ ok: true, profile: parsed.data });
};
