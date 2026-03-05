import { json } from '@sveltejs/kit';
import { getOrComputeStats } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats/wrapped?year=2025
 * Full year recap for Wrapped-style presentations.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const year = url.searchParams.get('year') ?? String(new Date().getFullYear() - 1);
	const period = `year:${year}`;

	const [all, movies, shows, books, games, music] = ['all', 'movie', 'show', 'book', 'game', 'music'].map(
		(mt) => getOrComputeStats(locals.user!.id, period, mt, 3600_000)
	);

	// Monthly breakdown
	const monthly: { month: string; playTimeMs: number; sessions: number }[] = [];
	for (let m = 1; m <= 12; m++) {
		const monthPeriod = `month:${year}-${String(m).padStart(2, '0')}`;
		const s = getOrComputeStats(locals.user.id, monthPeriod, 'all', 3600_000);
		monthly.push({
			month: `${year}-${String(m).padStart(2, '0')}`,
			playTimeMs: s.totalPlayTimeMs,
			sessions: s.totalSessions
		});
	}

	return json({
		year: parseInt(year),
		overall: all,
		byType: { movies, shows, books, games, music },
		monthly
	});
};
