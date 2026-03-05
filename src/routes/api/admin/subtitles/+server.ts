import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getProviderStatus, getLanguageProfiles, getSystemHistory } from '$lib/adapters/bazarr';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.isAdmin) throw error(403, 'Admin only');

	const bazarrConfigs = getEnabledConfigs().filter((c) => c.type === 'bazarr');
	if (bazarrConfigs.length === 0) {
		return json({ providers: [], profiles: [], history: { events: [], total: 0 } });
	}

	const config = bazarrConfigs[0];
	const section = url.searchParams.get('section');
	const page = parseInt(url.searchParams.get('page') ?? '1', 10);
	const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);

	if (section === 'providers') {
		return json({ providers: await getProviderStatus(config) });
	}
	if (section === 'profiles') {
		return json({ profiles: await getLanguageProfiles(config) });
	}
	if (section === 'history') {
		return json(await getSystemHistory(config, { page, limit }));
	}

	// Return all sections
	const [providers, profiles, history] = await Promise.all([
		getProviderStatus(config),
		getLanguageProfiles(config),
		getSystemHistory(config, { page, limit })
	]);

	return json({ providers, profiles, history });
};
