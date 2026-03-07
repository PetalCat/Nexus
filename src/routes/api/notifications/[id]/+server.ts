import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markRead, deleteNotification } from '$lib/server/notifications';

// PATCH /api/notifications/:id — mark one as read
export const PATCH: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const ok = markRead(params.id, locals.user.id);
	return json({ ok });
};

// DELETE /api/notifications/:id — delete one
export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const ok = deleteNotification(params.id, locals.user.id);
	return json({ ok });
};
