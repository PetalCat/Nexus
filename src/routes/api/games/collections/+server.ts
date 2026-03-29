import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { invalidatePrefix } from '$lib/server/cache';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const rommConfigs = getConfigsForMediaType('game');
	if (rommConfigs.length === 0) return json({ collections: [] });

	const config = rommConfigs[0];
	const adapter = registry.get(config.type);
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const result = await adapter?.getSubItems?.(config, '', 'collection', {}, userCred);
	return json({ collections: result?.items ?? [] });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);
	const rommConfigs = getConfigsForMediaType('game');
	if (rommConfigs.length === 0) throw error(404, 'No RomM service configured');

	const config = rommConfigs[0];
	const adapter = registry.get(config.type);
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const { name, description } = await request.json();
	if (!name) throw error(400, 'name required');

	const result = await adapter?.manageCollection?.(config, 'create', { name, description }, userCred);
	invalidatePrefix('romm-collections');
	return json({ collection: result }, { status: 201 });
};
