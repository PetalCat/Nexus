import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getCalibreCategories } from '$lib/adapters/calibre';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const config = getEnabledConfigs().find(c => c.type === 'calibre');
	if (!config) throw error(404, 'No Calibre service configured');

	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const categories = await getCalibreCategories(config, userCred);
	return json({ categories });
};
