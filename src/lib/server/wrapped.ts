import { getRawDb } from '$lib/db';

export interface WrappedStats {
	year: number;
	totalHours: number;
	byType: Record<string, { hours: number; count: number }>;
	topGenres: Array<{ genre: string; hours: number }>;
	topItems: Array<{ title: string; type: string; hours: number; poster?: string }>;
	milestones: Array<{ label: string; value: string; icon: string }>;
	streaks: { longest: number; current: number };
	monthlyActivity: Array<{ month: string; hours: number }>;
}

/**
 * Year-in-review stats sourced from the canonical `play_sessions` table.
 *
 * Two classes of bugs the 2026-04-17 unification fixes:
 *   1. Time bounds were string literals ('2026-01-01') compared against
 *      integer unix-ms `started_at` — always-false filters, so Wrapped was
 *      empty for every user. Now bounds are unix-ms.
 *   2. `strftime('%Y-%m', started_at)` / `date(started_at)` were missing
 *      the `started_at / 1000, 'unixepoch', 'localtime'` conversion used by
 *      Insights, so grouping ran against integer epochs.
 */
export function computeWrapped(userId: string, year?: number): WrappedStats {
	const targetYear = year ?? new Date().getFullYear();
	const raw = getRawDb();
	const startMs = new Date(targetYear, 0, 1).getTime();
	const endMs = new Date(targetYear + 1, 0, 1).getTime();

	// Total time by media type
	const byTypeRows = raw.prepare(`
		SELECT media_type,
		       SUM(duration_ms) as total_ms,
		       COUNT(DISTINCT media_id) as item_count
		FROM play_sessions
		WHERE user_id = ? AND started_at >= ? AND started_at < ?
		GROUP BY media_type
	`).all(userId, startMs, endMs) as Array<{
		media_type: string; total_ms: number; item_count: number;
	}>;

	const byType: Record<string, { hours: number; count: number }> = {};
	let totalMs = 0;
	for (const row of byTypeRows) {
		const hours = Math.round((row.total_ms ?? 0) / 3_600_000 * 10) / 10;
		byType[row.media_type] = { hours, count: row.item_count };
		totalMs += row.total_ms ?? 0;
	}

	// Top items
	const topItemRows = raw.prepare(`
		SELECT media_title as title, media_type as type,
		       SUM(duration_ms) as total_ms
		FROM play_sessions
		WHERE user_id = ? AND started_at >= ? AND started_at < ?
		GROUP BY media_id
		ORDER BY total_ms DESC
		LIMIT 10
	`).all(userId, startMs, endMs) as Array<{
		title: string; type: string; total_ms: number;
	}>;

	// Top genres
	const genreRows = raw.prepare(`
		SELECT json_extract(metadata, '$.genres') as genres, duration_ms
		FROM play_sessions
		WHERE user_id = ? AND started_at >= ? AND started_at < ?
		  AND json_extract(metadata, '$.genres') IS NOT NULL
	`).all(userId, startMs, endMs) as Array<{ genres: string; duration_ms: number }>;

	const genreHours = new Map<string, number>();
	for (const row of genreRows) {
		try {
			const genres = JSON.parse(row.genres) as string[];
			for (const g of genres) {
				genreHours.set(g, (genreHours.get(g) ?? 0) + (row.duration_ms ?? 0));
			}
		} catch { /* skip malformed */ }
	}
	const topGenres = Array.from(genreHours.entries())
		.map(([genre, ms]) => ({ genre, hours: Math.round(ms / 3_600_000 * 10) / 10 }))
		.sort((a, b) => b.hours - a.hours)
		.slice(0, 10);

	// Monthly activity. `started_at` is unix-ms — divide by 1000 before
	// `strftime(..., 'unixepoch')` so the group keys are real months, not
	// epoch-seconds-as-if-they-were-iso.
	const monthly = raw.prepare(`
		SELECT strftime('%Y-%m', started_at / 1000, 'unixepoch', 'localtime') as month,
		       SUM(duration_ms) as total
		FROM play_sessions
		WHERE user_id = ? AND started_at >= ? AND started_at < ?
		GROUP BY month ORDER BY month
	`).all(userId, startMs, endMs) as Array<{ month: string; total: number }>;

	// Active days — `date()` needs the same conversion for user-local streaks.
	const activeDays = raw.prepare(`
		SELECT DISTINCT date(started_at / 1000, 'unixepoch', 'localtime') as day
		FROM play_sessions
		WHERE user_id = ? AND started_at >= ? AND started_at < ?
		ORDER BY day
	`).all(userId, startMs, endMs) as Array<{ day: string }>;

	// Longest streak across the year + trailing streak (ending today).
	let longest = 0;
	let running = 0;
	let prev = '';
	for (const { day } of activeDays) {
		if (prev) {
			const diff = (new Date(day).getTime() - new Date(prev).getTime()) / 86_400_000;
			running = diff === 1 ? running + 1 : 1;
		} else {
			running = 1;
		}
		longest = Math.max(longest, running);
		prev = day;
	}

	const today = new Date();
	const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
	const dayLookup = new Set(activeDays.map((d) => d.day));
	let current = 0;
	const cursor = new Date(today);
	while (true) {
		const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
		if (!dayLookup.has(key)) {
			// Allow "today" to be absent without breaking the streak (user hasn't
			// watched yet today but yesterday counts).
			if (key === todayStr) {
				cursor.setDate(cursor.getDate() - 1);
				continue;
			}
			break;
		}
		current++;
		cursor.setDate(cursor.getDate() - 1);
	}

	const totalHours = Math.round(totalMs / 3_600_000 * 10) / 10;
	const totalItems = byTypeRows.reduce((a, b) => a + b.item_count, 0);

	return {
		year: targetYear,
		totalHours,
		byType,
		topGenres,
		topItems: topItemRows.map(t => ({
			title: t.title,
			type: t.type,
			hours: Math.round(t.total_ms / 3_600_000 * 10) / 10
		})),
		milestones: [
			{ label: 'Total Hours', value: String(totalHours), icon: 'clock' },
			{ label: 'Unique Titles', value: String(totalItems), icon: 'film' },
			{ label: 'Longest Streak', value: `${longest} days`, icon: 'fire' },
			{ label: 'Top Genre', value: topGenres[0]?.genre ?? 'N/A', icon: 'star' }
		],
		streaks: { longest, current },
		monthlyActivity: monthly.map(m => ({
			month: m.month,
			hours: Math.round((m.total ?? 0) / 3_600_000 * 10) / 10
		}))
	};
}
