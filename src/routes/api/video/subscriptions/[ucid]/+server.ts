import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { removeChannelNotify } from '$lib/server/video-notifications';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });
	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });
	const adapter = registry.get(config.type);
	await adapter?.manageSubscription?.(config, 'subscribe', params.ucid, userCred);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ error: 'No Invidious service configured' }, { status: 404 });
	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });
	const adapter = registry.get(config.type);
	await adapter?.manageSubscription?.(config, 'unsubscribe', params.ucid, userCred);
	// Clean up notification entry when unsubscribing
	removeChannelNotify(locals.user.id, params.ucid);
	return json({ ok: true });
};
