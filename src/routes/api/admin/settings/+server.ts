import { json } from '@sveltejs/kit';
import { getAllSettings, setSetting } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });
	return json(getAllSettings());
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const { key, value } = await request.json();
	if (!key || typeof key !== 'string' || typeof value !== 'string') {
		return json({ error: 'Missing key or value' }, { status: 400 });
	}

	setSetting(key, value);
	return json({ ok: true });
};
