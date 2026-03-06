import { json } from '@sveltejs/kit';
import { deleteUser } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });
	deleteUser(params.id);
	return json({ ok: true });
};
