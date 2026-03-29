import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

// GET /api/discover/genres?type=movie|tv
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const type = url.searchParams.get('type') ?? 'movie';

	const genres = await withCache(`genres:${type}`, 3_600_000, async () => {
		const configs = getEnabledConfigs().filter((c) => {
			const adapter = registry.get(c.type);
			return !!adapter?.getServiceData;
		});

		for (const config of configs) {
			const adapter = registry.get(config.type);
			if (!adapter?.getServiceData) continue;
			const cred = getUserCredentialForService(locals.user!.id, config.id) ?? undefined;
			try {
				const data = await adapter.getServiceData(config, `genres-${type}`, {}, cred);
				if (data) return data;
			} catch { continue; }
		}
		return [];
	});

	return json(genres);
};
