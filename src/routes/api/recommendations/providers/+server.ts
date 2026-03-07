import { json } from '@sveltejs/kit';
import { recRegistry } from '$lib/server/recommendations/registry';
import { DEFAULT_PROFILE } from '$lib/server/recommendations/types';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const ctx = {
		userId: user.id,
		limit: 0,
		profile: DEFAULT_PROFILE,
		excludeIds: new Set<string>()
	};

	const providers = recRegistry.all().map((p) => ({
		id: p.id,
		displayName: p.displayName,
		category: p.category,
		requiresService: p.requiresService,
		ready: p.isReady(ctx)
	}));

	return json({ providers });
};
