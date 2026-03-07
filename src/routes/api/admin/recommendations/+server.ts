import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import { recRegistry } from '$lib/server/recommendations/registry';
import { invalidatePrefix } from '$lib/server/cache';
import { DEFAULT_PROFILE } from '$lib/server/recommendations/types';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const raw = getRawDb();

	const dummyCtx = {
		userId: user.id,
		limit: 0,
		profile: DEFAULT_PROFILE,
		excludeIds: new Set<string>()
	};

	const providers = recRegistry.all().map((p) => ({
		id: p.id,
		displayName: p.displayName,
		category: p.category,
		ready: p.isReady(dummyCtx)
	}));

	const cacheCount = raw.prepare(`SELECT COUNT(*) as c FROM recommendation_cache`).get() as { c: number };
	const affinityCount = raw.prepare(`SELECT COUNT(DISTINCT user_id) as c FROM user_genre_affinity`).get() as { c: number };
	const hiddenCount = raw.prepare(`SELECT COUNT(*) as c FROM user_hidden_items`).get() as { c: number };

	const settings = raw.prepare(`SELECT key, value FROM app_settings WHERE key LIKE 'rec:%'`).all() as Array<{ key: string; value: string }>;
	const weights: Record<string, string> = {};
	for (const s of settings) {
		weights[s.key] = s.value;
	}

	return json({
		providers,
		stats: {
			cachedResults: cacheCount.c,
			usersWithAffinity: affinityCount.c,
			hiddenItems: hiddenCount.c
		},
		globalWeights: weights
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const body = await request.json();
	const { action, weights } = body as { action?: string; weights?: Record<string, string> };

	const raw = getRawDb();

	if (action === 'recompute') {
		raw.prepare(`DELETE FROM recommendation_cache`).run();
		invalidatePrefix('rec-rows:');
		return json({ ok: true, message: 'Cache cleared, recommendations will be recomputed' });
	}

	if (weights) {
		for (const [key, value] of Object.entries(weights)) {
			raw.prepare(
				`INSERT INTO app_settings (key, value) VALUES (?, ?)
				 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
			).run(`rec:${key}`, String(value));
		}
		return json({ ok: true });
	}

	return json({ error: 'Unknown action' }, { status: 400 });
};
