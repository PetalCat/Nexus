import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import { DEFAULT_PROFILE } from '$lib/server/recommendations/types';
import { invalidatePrefix } from '$lib/server/cache';
import { invalidateHomepageCache } from '$lib/server/homepage-cache';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const raw = getRawDb();
	const row = raw.prepare(
		`SELECT config FROM user_rec_profiles WHERE user_id = ? AND is_default = 1 LIMIT 1`
	).get(user.id) as { config: string } | undefined;

	const profile = row?.config ? { ...DEFAULT_PROFILE, ...JSON.parse(row.config) } : DEFAULT_PROFILE;

	const hidden = raw.prepare(
		`SELECT media_id, reason, created_at FROM user_hidden_items WHERE user_id = ? ORDER BY created_at DESC`
	).all(user.id) as Array<{ media_id: string; reason: string | null; created_at: number }>;

	return json({ profile, hiddenItems: hidden });
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const raw = getRawDb();
	const now = Date.now();

	raw.prepare(
		`INSERT INTO user_rec_profiles (id, user_id, name, is_default, config, created_at, updated_at)
		 VALUES (?, ?, 'Default', 1, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`
	).run(`default:${user.id}`, user.id, JSON.stringify(body), now, now);

	invalidatePrefix(`rec-rows:${user.id}`);
	invalidateHomepageCache(user.id);

	return json({ ok: true });
};
