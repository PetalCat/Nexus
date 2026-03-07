import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getNotifications, getUnreadCount, markAllRead, clearAllNotifications } from '$lib/server/notifications';

// GET /api/notifications — list notifications
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const limit = parseInt(url.searchParams.get('limit') ?? '30');
	const offset = parseInt(url.searchParams.get('offset') ?? '0');
	const unreadOnly = url.searchParams.get('unread') === '1';

	const notifications = getNotifications(locals.user.id, { limit, offset, unreadOnly });
	const unreadCount = getUnreadCount(locals.user.id);

	return json({ notifications, unreadCount });
};

// PATCH /api/notifications — mark all as read
export const PATCH: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const count = markAllRead(locals.user.id);
	return json({ marked: count });
};

// DELETE /api/notifications — clear all
export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const count = clearAllNotifications(locals.user.id);
	return json({ deleted: count });
};
