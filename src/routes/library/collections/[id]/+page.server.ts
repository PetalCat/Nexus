import { error } from '@sveltejs/kit';
import { getCollection } from '$lib/server/social';
import { getCollectionActivity } from '$lib/server/collection-activity';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const collection = getCollection(params.id, locals.user.id);
	if (!collection) throw error(404, 'Collection not found');

	const activity = getCollectionActivity(params.id, { limit: 20 });

	return { collection, activity };
};
