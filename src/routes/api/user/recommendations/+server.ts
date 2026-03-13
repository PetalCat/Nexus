import { json } from '@sveltejs/kit';
import { getDb, getRawDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getStreamyStatsRecommendations } from '$lib/adapters/streamystats';
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

		// Load dismissed/downvoted items
		const raw = getRawDb();
		const feedback = raw.prepare(
			`SELECT media_id, feedback FROM recommendation_feedback WHERE user_id = ?`
		).all(userId) as { media_id: string; feedback: string }[];
		const dismissed = new Set(
			feedback.filter((f) => f.feedback === 'dismiss' || f.feedback === 'down').map((f) => f.media_id)
		);

		// Load preferences
		const prefRow = raw.prepare(
			`SELECT similarity_threshold FROM recommendation_preferences WHERE user_id = ?`
		).get(userId) as { similarity_threshold: number } | undefined;
		const threshold = prefRow?.similarity_threshold ?? 0.5;

		// Filter out dismissed items and apply similarity threshold
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
