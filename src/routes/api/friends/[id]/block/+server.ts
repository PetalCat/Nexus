import { json } from '@sveltejs/kit';
import { blockUser, unblockUser } from '$lib/server/social';
import type { RequestHandler } from './$types';

// POST /api/friends/:id/block — block a user
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const ok = blockUser(locals.user.id, params.id);
	if (!ok) return json({ error: 'Cannot block this user' }, { status: 400 });

	return json({ ok: true });
};

// DELETE /api/friends/:id/block — unblock a user
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const ok = unblockUser(locals.user.id, params.id);
	if (!ok) return json({ error: 'Not blocked' }, { status: 404 });

	return json({ ok: true });
};
