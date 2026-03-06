import { json } from '@sveltejs/kit';
import { getFriends, getBlockedUserIds, getBlockedByUserIds } from '$lib/server/social';
import { getAllUsers } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// GET /api/friends — list all friends with presence
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const friends = getFriends(locals.user.id);
	return json({ friends });
};

// POST /api/friends — search users to add (not a friend action itself)
// Body: { query: string } — search by username/displayName
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { query } = await request.json();
	if (!query || typeof query !== 'string') return json({ error: 'Missing query' }, { status: 400 });

	const all = getAllUsers();
	const q = query.toLowerCase();

	// Exclude blocked users (in both directions)
	const blockedIds = new Set([
		...getBlockedUserIds(locals.user.id),
		...getBlockedByUserIds(locals.user.id)
	]);

	const results = all
		.filter((u) => u.id !== locals.user!.id && !blockedIds.has(u.id) && (u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)))
		.map((u) => ({ id: u.id, username: u.username, displayName: u.displayName }))
		.slice(0, 20);

	return json({ users: results });
};
