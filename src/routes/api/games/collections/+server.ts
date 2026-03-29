import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getCollections, createCollection } from '$lib/adapters/romm';
import { invalidatePrefix } from '$lib/server/cache';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const rommConfigs = getConfigsForMediaType('game');
	if (rommConfigs.length === 0) return json({ collections: [] });

	const config = rommConfigs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const collections = await getCollections(config, userCred);
	return json({ collections });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);
	const rommConfigs = getConfigsForMediaType('game');
	if (rommConfigs.length === 0) throw error(404, 'No RomM service configured');

	const config = rommConfigs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const { name, description } = await request.json();
	if (!name) throw error(400, 'name required');

	const collection = await createCollection(config, name, description, userCred);
	invalidatePrefix('romm-collections');
	return json({ collection }, { status: 201 });
};
