import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getConfigsForMediaType('video');
	if (configs.length === 0) return json({ items: [] });
	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	const adapter = registry.get(config.type);
	const view = url.searchParams.get('view');
	if (view === 'channels') {
		const subs = await adapter?.getServiceData?.(config, 'subscriptions', {}, userCred) ?? [];
		return json({ subscriptions: subs });
	}

	const page = parseInt(url.searchParams.get('page') ?? '1');
	const feed = await adapter?.getServiceData?.(config, 'subscription-feed', { page }, userCred);
	return json(feed);
};
