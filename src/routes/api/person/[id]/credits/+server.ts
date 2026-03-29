import { json, error } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

// GET /api/person/:id/credits — person filmography from Overseerr/TMDB
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const credits = await withCache(`person-credits:${params.id}`, 1_800_000, async () => {
		const configs = getEnabledConfigs();
		for (const config of configs) {
			const adapter = registry.get(config.type);
			if (!adapter?.getServiceData) continue;
			const cred = getUserCredentialForService(locals.user!.id, config.id) ?? undefined;
			try {
				const data = await adapter.getServiceData(config, 'person-credits', { personId: params.id }, cred);
				if (data) return data;
			} catch { continue; }
		}
		return null;
	});

	if (!credits) throw error(404, 'Credits not found');
	return json(credits);
};
