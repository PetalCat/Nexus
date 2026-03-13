import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const raw = getRawDb();
	const feedback = raw.prepare(
		`SELECT id, user_id, media_id, media_title, feedback, reason, created_at
		 FROM recommendation_feedback
		 WHERE user_id = ?
		 ORDER BY created_at DESC`
	).all(locals.user.id);

	return json({ feedback });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { mediaId, mediaTitle, feedback, reason } = await request.json();
	if (!mediaId || !feedback) return json({ error: 'mediaId and feedback required' }, { status: 400 });

	const raw = getRawDb();
	raw.prepare(`
		INSERT INTO recommendation_feedback (user_id, media_id, media_title, feedback, reason, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, media_id) DO UPDATE SET
			feedback = excluded.feedback,
			reason = excluded.reason,
			created_at = excluded.created_at
	`).run(
		locals.user.id,
		mediaId,
		mediaTitle ?? null,
		feedback,
		reason ?? null,
		Date.now()
	);

	return json({ ok: true });
};
