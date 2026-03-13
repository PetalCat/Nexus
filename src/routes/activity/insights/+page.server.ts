import { computeStats } from '$lib/server/stats-engine';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user!.id;
	const now = Date.now();

	// Parse period from URL params or default to 7 days
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');

	const to = toParam ? parseInt(toParam) : now;
	const from = fromParam ? parseInt(fromParam) : to - 7 * 24 * 60 * 60 * 1000;

	// Compute stats for current period
	const stats = computeStats(userId, from, to);

	// Compute stats for previous period (same duration, shifted back)
	const duration = to - from;
	const prevFrom = from - duration;
	const prevTo = from;
	const prevStats = computeStats(userId, prevFrom, prevTo);

	return {
		from,
		to,
		stats,
		prevStats
	};
};
