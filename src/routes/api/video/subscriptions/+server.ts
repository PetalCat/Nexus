import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getSubscriptions, getSubscriptionFeed } from '$lib/adapters/invidious';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const configs = getEnabledConfigs().filter(c => c.type === 'invidious');
	if (configs.length === 0) return json({ items: [] });
	const config = configs[0];
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	if (!userCred) return json({ error: 'Invidious account not linked' }, { status: 403 });

	const view = url.searchParams.get('view');
	if (view === 'channels') {
		const subs = await getSubscriptions(config, userCred);
		return json({ subscriptions: subs });
	}

	const page = parseInt(url.searchParams.get('page') ?? '1');
	const feed = await getSubscriptionFeed(config, userCred, page);
	return json(feed);
};
