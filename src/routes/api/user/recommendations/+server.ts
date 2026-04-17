import { json } from '@sveltejs/kit';
import { getDb, getRawDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getStreamyStatsRecommendations } from '$lib/adapters/streamystats';
import { parseRecProfileConfig } from '$lib/server/recommendations/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const db = getDb();
	const userId = locals.user.id;

	// Find StreamyStats service
	const ssServices = db
		.select()
		.from(schema.services)
		.where(eq(schema.services.type, 'streamystats'))
		.all();

	if (ssServices.length === 0) {
		return json({ recommendations: [], error: 'No StreamyStats service configured' });
	}

	const ssConfig = getServiceConfig(ssServices[0].id);
	if (!ssConfig) return json({ recommendations: [] });

	// StreamyStats authenticates via Jellyfin user tokens (not its own)
	const jellyfinService = db
		.select({ id: schema.services.id })
		.from(schema.services)
		.where(eq(schema.services.type, 'jellyfin'))
		.limit(1)
		.all();
	if (jellyfinService.length === 0) {
		return json({ recommendations: [], error: 'No Jellyfin service configured' });
	}
	const userCred = getUserCredentialForService(userId, jellyfinService[0].id);
	if (!userCred?.accessToken) {
		return json({ recommendations: [], error: 'No Jellyfin credentials linked' });
	}

	try {
		const recs = await getStreamyStatsRecommendations(ssConfig, 'all', userCred, 50);

		// Dismiss-list comes from the canonical user_hidden_items table.
		const raw = getRawDb();
		const hiddenRows = raw.prepare(
			`SELECT media_id FROM user_hidden_items WHERE user_id = ?`
		).all(userId) as Array<{ media_id: string }>;
		const dismissed = new Set(hiddenRows.map((h) => h.media_id));

		// Similarity threshold from the canonical RecProfileConfig. `noveltyFactor`
		// is 0=familiar / 1=adventurous; invert it to a "similarity floor" the
		// adapter recs must clear.
		const profileRow = raw.prepare(
			`SELECT config FROM user_rec_profiles WHERE user_id = ? AND is_default = 1 LIMIT 1`
		).get(userId) as { config: string } | undefined;
		const profile = parseRecProfileConfig(profileRow?.config);
		const threshold = 1 - (profile.noveltyFactor ?? 0.5);

		let filtered = recs.filter((r) => !dismissed.has(r.id));
		filtered = filtered.filter((r) => {
			const sim = (r as any).similarity ?? 1;
			return sim >= threshold;
		});

		return json({ recommendations: filtered.slice(0, 20) });
	} catch (e) {
		console.error('[Recommendations] Error:', e);
		return json({ recommendations: [], error: 'Failed to fetch recommendations' });
	}
};
