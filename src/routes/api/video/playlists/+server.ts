import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getUserPlaylists, createPlaylist } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ playlists: [] });
	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });
	const playlists = await getUserPlaylists(config, userCred);
	return json({ playlists });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });
	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });
	const body = await request.json();
	if (!body.title) return json({ error: 'title is required' }, { status: 400 });
	const result = await createPlaylist(config, body.title, body.privacy ?? 'private', userCred);
	return json(result, { status: 201 });
};
