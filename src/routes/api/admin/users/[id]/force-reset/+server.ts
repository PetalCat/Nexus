import { json } from '@sveltejs/kit';
import { setForcePasswordReset } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const { force } = await request.json();
	if (typeof force !== 'boolean') return json({ error: 'force must be boolean' }, { status: 400 });

	setForcePasswordReset(params.id, force);
	return json({ ok: true });
};
