import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ playlists: [] });
	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });
	const adapter = registry.get(config.type);
	const playlists = await adapter?.getServiceData?.(config, 'playlists', {}, userCred) ?? [];
	return json({ playlists });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });
	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });
	const body = await request.json();
	if (!body.title) return json({ error: 'title is required' }, { status: 400 });
	const adapter = registry.get(config.type);
	const result = await adapter?.manageCollection?.(config, 'create', { name: body.title, privacy: body.privacy ?? 'private' }, userCred);
	return json(result, { status: 201 });
};
