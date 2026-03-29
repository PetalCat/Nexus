import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSuggestions } from '$lib/server/auto-suggest';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const suggestions = await getSuggestions(locals.user.id);
	return json(suggestions);
};
