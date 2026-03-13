import { computeStats } from '$lib/server/stats-engine';
import { getRawDb } from '$lib/db';
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

	// Compute daily timeline data for the bar chart
	const raw = getRawDb();
	const dailyRows = raw.prepare(`
		SELECT date(started_at / 1000, 'unixepoch', 'localtime') as day,
		       SUM(duration_ms) as total_ms,
		       COUNT(*) as sessions
		FROM play_sessions
		WHERE user_id = ? AND started_at >= ? AND started_at <= ?
		GROUP BY day
		ORDER BY day ASC
	`).all(userId, from, to) as { day: string; total_ms: number; sessions: number }[];

	// Compute per-day activity for the calendar grid
	const calendarRows = raw.prepare(`
		SELECT date(started_at / 1000, 'unixepoch', 'localtime') as day,
		       SUM(duration_ms) as total_ms
		FROM play_sessions
		WHERE user_id = ? AND started_at >= ? AND started_at <= ?
		GROUP BY day
		ORDER BY day ASC
	`).all(userId, from - 365 * 86400000, to) as { day: string; total_ms: number }[];

	const dailyTimeline = dailyRows.map((r) => ({
		day: r.day,
		totalMs: r.total_ms ?? 0,
		sessions: r.sessions ?? 0
	}));

	const calendarData = Object.fromEntries(calendarRows.map((r) => [r.day, r.total_ms ?? 0]));

	return {
		from,
		to,
		stats,
		prevStats,
		dailyTimeline,
		calendarData
	};
};
