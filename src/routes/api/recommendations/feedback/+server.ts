import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRawDb } from '$lib/db';
import { invalidatePrefix } from '$lib/server/cache';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { mediaId, action, reason } = body as {
		mediaId?: string;
		action?: 'hide' | 'not_interested';
		reason?: string;
	};

	if (!mediaId || !action) {
		return json({ error: 'mediaId and action are required' }, { status: 400 });
	}

	const raw = getRawDb();
	raw.prepare(
		`INSERT INTO user_hidden_items (user_id, media_id, service_id, reason, created_at)
		 VALUES (?, ?, '', ?, ?)
		 ON CONFLICT(user_id, media_id) DO UPDATE SET reason = excluded.reason`
	).run(user.id, mediaId, reason ?? action, Date.now());

	// Invalidate cached recommendations for this user
	invalidatePrefix(`rec-rows:${user.id}`);

	return json({ ok: true });
};
