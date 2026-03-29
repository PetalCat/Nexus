import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });
	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });
	const adapter = registry.get(config.type);
	await adapter?.manageCollection?.(config, 'removeItems', { id: params.id, itemIds: [params.index] }, userCred);
	return json({ ok: true });
};
