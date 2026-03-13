import { json } from '@sveltejs/kit';
import { areFriends, getFriendActivity } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET /api/friends/:id/activity — activity history for one friend
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!areFriends(locals.user.id, params.id)) return json({ error: 'Not friends' }, { status: 403 });

	const limit = parseInt(url.searchParams.get('limit') ?? '50');
	const offset = parseInt(url.searchParams.get('offset') ?? '0');

	const { getRawDb } = await import('$lib/db');
	const raw = getRawDb();
	const events = raw.prepare(
		`SELECT * FROM play_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`
	).all(params.id, limit, offset) as any[];

	return json({ activity: events });
};
