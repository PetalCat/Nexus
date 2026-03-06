import { json } from '@sveltejs/kit';
import { markSharedSeen } from '$lib/server/social';
import type { RequestHandler } from './$types';

// PUT /api/shared/:id/seen — mark a shared item as seen
export const PUT: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const ok = markSharedSeen(params.id, locals.user.id);
	if (!ok) return json({ error: 'Not found' }, { status: 404 });

	return json({ ok: true });
};
