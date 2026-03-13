import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const raw = getRawDb();
	const row = raw.prepare(
		`SELECT media_type_weights, genre_preferences, similarity_threshold FROM recommendation_preferences WHERE user_id = ?`
	).get(locals.user.id) as { media_type_weights: string; genre_preferences: string; similarity_threshold: number } | undefined;

	if (!row) {
		return json({
			mediaTypeWeights: { movie: 50, show: 50, book: 50, game: 50, music: 50, video: 50 },
			genrePreferences: {},
			similarityThreshold: 0.5
		});
	}

	return json({
		mediaTypeWeights: JSON.parse(row.media_type_weights),
		genrePreferences: JSON.parse(row.genre_preferences),
		similarityThreshold: row.similarity_threshold
	});
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const raw = getRawDb();

	raw.prepare(`
		INSERT INTO recommendation_preferences (user_id, media_type_weights, genre_preferences, similarity_threshold, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			media_type_weights = excluded.media_type_weights,
			genre_preferences = excluded.genre_preferences,
			similarity_threshold = excluded.similarity_threshold,
			updated_at = excluded.updated_at
	`).run(
		locals.user.id,
		JSON.stringify(body.mediaTypeWeights ?? {}),
		JSON.stringify(body.genrePreferences ?? {}),
		body.similarityThreshold ?? 0.5,
		Date.now()
	);

	return json({ ok: true });
};
