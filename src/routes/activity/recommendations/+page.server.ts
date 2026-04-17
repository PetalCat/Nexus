import { getRawDb } from '$lib/db';
import { computeStats } from '$lib/server/stats-engine';
import { parseRecProfileConfig, DEFAULT_PROFILE } from '$lib/server/recommendations/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const userId = locals.user!.id;
	const { hasStreamyStats } = await parent();
	const raw = getRawDb();

	// Canonical RecProfileConfig blob.
	const row = raw.prepare(
		`SELECT config FROM user_rec_profiles WHERE user_id = ? AND is_default = 1 LIMIT 1`
	).get(userId) as { config: string } | undefined;
	const profile = parseRecProfileConfig(row?.config);

	// Hidden items (the feedback-history surface — formerly the
	// recommendation_feedback table).
	const hiddenItems = raw.prepare(
		`SELECT id, media_id, service_id, reason, created_at
		 FROM user_hidden_items
		 WHERE user_id = ? ORDER BY created_at DESC`
	).all(userId) as Array<{
		id: number;
		media_id: string;
		service_id: string | null;
		reason: string | null;
		created_at: number;
	}>;

	// User's consumed genres for the tuning UI.
	const allTimeStats = computeStats(userId, 0, Date.now());
	const consumedGenres = allTimeStats.topGenres.map((g) => g.genre);

	return {
		hasStreamyStats,
		profile,
		defaultProfile: DEFAULT_PROFILE,
		hiddenItems,
		consumedGenres
	};
};
