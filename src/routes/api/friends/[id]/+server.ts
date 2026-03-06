import { json } from '@sveltejs/kit';
import { getFriends, removeFriend } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET /api/friends/:id — single friend profile
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const friends = getFriends(locals.user.id);
	const friend = friends.find((f) => f.userId === params.id);
	if (!friend) return json({ error: 'Not found' }, { status: 404 });

	return json({ friend });
};

// DELETE /api/friends/:id — remove friend
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const ok = removeFriend(locals.user.id, params.id);
	if (!ok) return json({ error: 'Not found' }, { status: 404 });

	return json({ ok: true });
};
