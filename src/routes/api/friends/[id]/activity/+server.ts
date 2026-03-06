import { json } from '@sveltejs/kit';
import { areFriends, getFriendActivity } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET /api/friends/:id/activity — activity history for one friend
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!areFriends(locals.user.id, params.id)) return json({ error: 'Not friends' }, { status: 403 });

	const limit = parseInt(url.searchParams.get('limit') ?? '50');
	const offset = parseInt(url.searchParams.get('offset') ?? '0');

	// getFriendActivity filters by friend IDs; we pass a single-friend subset
	const { getFriendIds: _, ...rest } = await import('$lib/server/social');
	const { getDb, schema } = await import('$lib/db');
	const { eq, desc } = await import('drizzle-orm');

	const db = getDb();
	const events = db
		.select()
		.from(schema.mediaEvents)
		.where(eq(schema.mediaEvents.userId, params.id))
		.orderBy(desc(schema.mediaEvents.timestamp))
		.limit(limit)
		.offset(offset)
		.all();

	return json({ activity: events });
};
