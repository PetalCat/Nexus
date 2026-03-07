import { json } from '@sveltejs/kit';
import { getRecommendations } from '$lib/server/recommendations/aggregator';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const mediaId = url.searchParams.get('mediaId');
	const mediaType = url.searchParams.get('type') ?? undefined;
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '12', 10), 50);

	if (!mediaId) return json({ error: 'mediaId required' }, { status: 400 });

	const recs = await getRecommendations(user.id, mediaType, limit);

	return json({
		similar: recs.map((r) => ({
			item: r.item,
			score: r.score,
			reason: r.reason,
			provider: r.provider
		}))
	});
};
