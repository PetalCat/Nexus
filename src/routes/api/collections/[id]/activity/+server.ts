import { json } from '@sveltejs/kit';
import { getCollectionActivity } from '$lib/server/collection-activity';
import { getCollection } from '$lib/server/social';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	// Verify access
	const collection = getCollection(params.id, locals.user.id);
	if (!collection) return json({ error: 'Not found' }, { status: 404 });

	const limit = parseInt(url.searchParams.get('limit') ?? '20');
	const offset = parseInt(url.searchParams.get('offset') ?? '0');

	const activity = getCollectionActivity(params.id, { limit, offset });
	return json({ activity });
};
