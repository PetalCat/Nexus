import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import type { RequestHandler } from './$types';

// DELETE /api/user/recommendations/feedback/:id
// Removes a row from user_hidden_items (i.e. "unhide"). The legacy
// recommendation_feedback table was dropped 2026-04-17; this endpoint now
// operates on the canonical hidden-items store.
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const raw = getRawDb();
	raw.prepare(
		`DELETE FROM user_hidden_items WHERE id = ? AND user_id = ?`
	).run(id, locals.user.id);

	return json({ ok: true });
};
