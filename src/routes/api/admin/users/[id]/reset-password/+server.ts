import { json } from '@sveltejs/kit';
import { resetUserPassword } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const { password } = await request.json();
	if (!password || typeof password !== 'string' || password.length < 6) {
		return json({ error: 'Password must be at least 6 characters' }, { status: 400 });
	}

	resetUserPassword(params.id, password);
	return json({ ok: true });
};
