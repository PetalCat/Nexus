import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { invalidatePrefix } from '$lib/server/cache';

function getRommConfig() {
	const configs = getConfigsForMediaType('game');
	if (configs.length === 0) throw error(404, 'No RomM service configured');
	return configs[0];
}

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401);
	const config = getRommConfig();
	const adapter = registry.get(config.type);
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const data = await request.json();
	await adapter?.manageCollection?.(config, 'update', { id: params.id, ...data }, userCred);
	invalidatePrefix('romm-collections');
	return json({ collection: data });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const config = getRommConfig();
	const adapter = registry.get(config.type);
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	await adapter?.manageCollection?.(config, 'delete', { id: params.id }, userCred);
	invalidatePrefix('romm-collections');
	return json({ ok: true });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401);
	const config = getRommConfig();
	const adapter = registry.get(config.type);
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const { action, romIds } = await request.json();
	if (!action || !Array.isArray(romIds)) throw error(400, 'action and romIds required');

	const result = await adapter?.getSubItems?.(config, params.id, 'collection', {}, userCred);
	const existingRoms: number[] = (result?.items as any) ?? [];

	let updatedRoms: number[];
	if (action === 'add') {
		const current = new Set(existingRoms);
		romIds.forEach((id: number) => current.add(id));
		updatedRoms = [...current];
	} else if (action === 'remove') {
		const toRemove = new Set(romIds);
		updatedRoms = existingRoms.filter((id: number) => !toRemove.has(id));
	} else {
		throw error(400, 'action must be "add" or "remove"');
	}

	await adapter?.manageCollection?.(config, 'addItems', { id: params.id, itemIds: updatedRoms.map(String) }, userCred);
	invalidatePrefix('romm-collections');
	return json({ collection: { roms: updatedRoms } });
};
