import { json } from '@sveltejs/kit';
import { getDashboard } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		const rows = await getDashboard(locals.user?.id);
		return json(rows);
	} catch (e) {
		console.error('[API] dashboard error', e);
		return json({ error: 'Failed to load dashboard' }, { status: 500 });
	}
};
