import { json } from '@sveltejs/kit';
import { approveUser } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ params, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });
	approveUser(params.id);
	return json({ ok: true });
};
