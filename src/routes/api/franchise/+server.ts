import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getFranchiseData } from '$lib/server/franchise';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const name = url.searchParams.get('name');
	if (!name) return json({ error: 'Missing name param' }, { status: 400 });

	const data = await getFranchiseData(name, locals.user.id);
	return json(data);
};
