import { json } from '@sveltejs/kit';
import { getOrComputeStats, computeStats } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats?period=day:2026-03-04&type=movie
 * OR
 * GET /api/user/stats?from=1709510400000&to=1710115200000&type=movie
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const mediaType = url.searchParams.get('type') ?? 'all';
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');

	if (fromParam && toParam) {
		const from = parseInt(fromParam);
		const to = parseInt(toParam);
		if (isNaN(from) || isNaN(to)) {
			return json({ error: 'from and to must be unix ms timestamps' }, { status: 400 });
		}
		const stats = computeStats(locals.user.id, from, to, mediaType !== 'all' ? mediaType : undefined);
		return json({ from, to, mediaType, stats });
	}

	const period = url.searchParams.get('period') ?? 'alltime';
	const stats = getOrComputeStats(locals.user.id, period, mediaType);
	return json({ period, mediaType, stats });
};
