import { json, error } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

// GET /api/person/:id — person detail from Overseerr/TMDB
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	// Key includes userId because the lookup iterates the caller's enabled
	// service configs in order and uses their per-user credentials. Without
	// userId scoping, another user could be served a response derived from a
	// different user's service set/credentials.
	const person = await withCache(`person:${locals.user.id}:${params.id}`, 3_600_000, async () => {
		const configs = getEnabledConfigs();
		for (const config of configs) {
			const adapter = registry.get(config.type);
			if (!adapter?.getServiceData) continue;
			const cred = getUserCredentialForService(locals.user!.id, config.id) ?? undefined;
			try {
				const data = await adapter.getServiceData(config, 'person', { personId: params.id }, cred);
				if (data) return data;
			} catch { continue; }
		}
		return null;
	});

	if (!person) throw error(404, 'Person not found');
	return json(person);
};
