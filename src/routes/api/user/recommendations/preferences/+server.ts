import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import {
	RecProfileConfigSchema,
	parseRecProfileConfig
} from '$lib/server/recommendations/types';
import { invalidatePrefix } from '$lib/server/cache';
import { invalidateHomepageCache } from '$lib/server/homepage-cache';
import type { RequestHandler } from './$types';

/**
 * Alias for `/api/recommendations/preferences`. Both endpoints share the one
 * canonical `user_rec_profiles.config` store; kept as a back-compat surface
 * for homepage cards that still POST here.
 */

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const raw = getRawDb();
	const row = raw.prepare(
		`SELECT config FROM user_rec_profiles WHERE user_id = ? AND is_default = 1 LIMIT 1`
	).get(locals.user.id) as { config: string } | undefined;
	return json(parseRecProfileConfig(row?.config));
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
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
		`default:${locals.user.id}`,
		locals.user.id,
		JSON.stringify(parsed.data),
		now,
		now
	);

	invalidatePrefix(`rec-rows:${locals.user.id}`);
	invalidateHomepageCache(locals.user.id);

	return json({ ok: true, profile: parsed.data });
};
