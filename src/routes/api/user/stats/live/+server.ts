import { json } from '@sveltejs/kit';
import { computeStats, currentPeriod } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats/live
 * Real-time stats for today — always computed fresh.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const today = currentPeriod('day');
	const stats = computeStats(locals.user.id, today.from, today.to);

	return json({ period: today.period, stats });
};
