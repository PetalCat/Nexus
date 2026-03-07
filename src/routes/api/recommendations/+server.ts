import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRecommendations } from '$lib/server/recommendations/aggregator';

export const GET: RequestHandler = async ({ url, locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const mediaType = url.searchParams.get('type') ?? undefined;
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100);

	const recs = await getRecommendations(user.id, mediaType, limit);

	return json({
		recommendations: recs.map((r) => ({
			item: r.item,
			score: r.score,
			confidence: r.confidence,
			provider: r.provider,
			reason: r.reason,
			reasonType: r.reasonType,
			basedOn: r.basedOn
		})),
		total: recs.length
	});
};
