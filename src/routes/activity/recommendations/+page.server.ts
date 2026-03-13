import { getRawDb } from '$lib/db';
import { computeStats } from '$lib/server/stats-engine';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const userId = locals.user!.id;
	const { hasStreamyStats } = await parent();
	const raw = getRawDb();

	// Load preferences
	const prefRow = raw.prepare(
		`SELECT media_type_weights, genre_preferences, similarity_threshold FROM recommendation_preferences WHERE user_id = ?`
	).get(userId) as { media_type_weights: string; genre_preferences: string; similarity_threshold: number } | undefined;

	const preferences = prefRow
		? {
				mediaTypeWeights: JSON.parse(prefRow.media_type_weights),
				genrePreferences: JSON.parse(prefRow.genre_preferences) as Record<string, string>,
				similarityThreshold: prefRow.similarity_threshold
			}
		: {
				mediaTypeWeights: { movie: 50, show: 50, book: 50, game: 50, music: 50, video: 50 } as Record<string, number>,
				genrePreferences: {} as Record<string, string>,
				similarityThreshold: 0.5
			};

	// Load feedback history
	const feedback = raw.prepare(
		`SELECT id, user_id, media_id, media_title, feedback, reason, created_at
		 FROM recommendation_feedback WHERE user_id = ? ORDER BY created_at DESC`
	).all(userId) as {
		id: number; user_id: string; media_id: string; media_title: string | null;
		feedback: string; reason: string | null; created_at: number;
	}[];

	// Get user's consumed genres for the tuning UI
	const allTimeStats = computeStats(userId, 0, Date.now());
	const consumedGenres = allTimeStats.topGenres.map((g) => g.genre);

	return {
		hasStreamyStats,
		preferences,
		feedback,
		consumedGenres
	};
};
