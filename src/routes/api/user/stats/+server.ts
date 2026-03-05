import { json } from '@sveltejs/kit';
import { getOrComputeStats } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats?period=day:2026-03-04&type=movie
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const period = url.searchParams.get('period') ?? 'alltime';
	const mediaType = url.searchParams.get('type') ?? 'all';

	const stats = getOrComputeStats(locals.user.id, period, mediaType);
	return json({ period, mediaType, stats });
};
