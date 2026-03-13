import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	const raw = getRawDb();
	raw.prepare(
		`DELETE FROM recommendation_feedback WHERE id = ? AND user_id = ?`
	).run(id, locals.user.id);

	return json({ ok: true });
};
