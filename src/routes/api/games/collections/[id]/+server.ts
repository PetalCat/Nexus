import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { updateCollection, deleteCollection, getCollection, updateCollectionRoms } from '$lib/adapters/romm';
import { invalidatePrefix } from '$lib/server/cache';

function getRommConfig() {
	const configs = getConfigsForMediaType('game');
	if (configs.length === 0) throw error(404, 'No RomM service configured');
	return configs[0];
}

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401);
	const config = getRommConfig();
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const data = await request.json();
	const collection = await updateCollection(config, Number(params.id), data, userCred);
	invalidatePrefix('romm-collections');
	return json({ collection });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const config = getRommConfig();
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const ok = await deleteCollection(config, Number(params.id), userCred);
	if (!ok) throw error(500, 'Failed to delete collection');
	invalidatePrefix('romm-collections');
	return json({ ok: true });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401);
	const config = getRommConfig();
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const { action, romIds } = await request.json();
	if (!action || !Array.isArray(romIds)) throw error(400, 'action and romIds required');

	const existing = await getCollection(config, Number(params.id), userCred);
	if (!existing) throw error(404, 'Collection not found');

	let updatedRoms: number[];
	if (action === 'add') {
		const current = new Set(existing.roms ?? []);
		romIds.forEach((id: number) => current.add(id));
		updatedRoms = [...current];
	} else if (action === 'remove') {
		const toRemove = new Set(romIds);
		updatedRoms = (existing.roms ?? []).filter((id: number) => !toRemove.has(id));
	} else {
		throw error(400, 'action must be "add" or "remove"');
	}

	const collection = await updateCollectionRoms(config, Number(params.id), updatedRoms, userCred);
	invalidatePrefix('romm-collections');
	return json({ collection });
};
