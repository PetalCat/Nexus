import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getCalibreAuthors } from '$lib/adapters/calibre';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const config = getConfigsForMediaType('book')[0];
	if (!config) throw error(404, 'No Calibre service configured');

	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const authors = await getCalibreAuthors(config, userCred);
	return json({ authors });
};
