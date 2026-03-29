import { getRawDb } from '$lib/db';
import { withCache } from './cache';

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

export function computeWrapped(userId: string, year?: number): WrappedStats {
	const targetYear = year ?? new Date().getFullYear();
	const raw = getRawDb();
	const startDate = `${targetYear}-01-01`;
	const endDate = `${targetYear + 1}-01-01`;

	// Total time by media type
	const byTypeRows = raw.prepare(`
		SELECT media_type,
		       SUM(duration_ms) as total_ms,
		       COUNT(DISTINCT media_id) as item_count
		FROM play_sessions
		WHERE user_id = ? AND started_at >= ? AND started_at < ?
		GROUP BY media_type
	`).all(userId, startDate, endDate) as Array<{
		media_type: string; total_ms: number; item_count: number;
	}>;

	const byType: Record<string, { hours: number; count: number }> = {};
	let totalMs = 0;
	for (const row of byTypeRows) {
		const hours = Math.round(row.total_ms / 3_600_000 * 10) / 10;
		byType[row.media_type] = { hours, count: row.item_count };
		totalMs += row.total_ms;
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
	`).all(userId, startDate, endDate) as Array<{
		title: string; type: string; total_ms: number;
	}>;

	// Top genres
	const genreRows = raw.prepare(`
		SELECT json_extract(metadata, '$.genres') as genres, duration_ms
		FROM play_sessions
		WHERE user_id = ? AND started_at >= ? AND started_at < ?
		  AND json_extract(metadata, '$.genres') IS NOT NULL
	`).all(userId, startDate, endDate) as Array<{ genres: string; duration_ms: number }>;

	const genreHours = new Map<string, number>();
	for (const row of genreRows) {
		try {
			const genres = JSON.parse(row.genres) as string[];
			for (const g of genres) {
				genreHours.set(g, (genreHours.get(g) ?? 0) + row.duration_ms);
			}
		} catch { /* skip malformed */ }
	}
	const topGenres = Array.from(genreHours.entries())
		.map(([genre, secs]) => ({ genre, hours: Math.round(secs / 3_600_000 * 10) / 10 }))
		.sort((a, b) => b.hours - a.hours)
		.slice(0, 10);

	// Monthly activity
	const monthly = raw.prepare(`
		SELECT strftime('%Y-%m', started_at) as month, SUM(duration_ms) as total
		FROM play_sessions
		WHERE user_id = ? AND started_at >= ? AND started_at < ?
		GROUP BY month ORDER BY month
	`).all(userId, startDate, endDate) as Array<{ month: string; total: number }>;

	// Streaks
	const activeDays = raw.prepare(`
		SELECT DISTINCT date(started_at) as day
		FROM play_sessions
		WHERE user_id = ? AND started_at >= ? AND started_at < ?
		ORDER BY day
	`).all(userId, startDate, endDate) as Array<{ day: string }>;

	let longest = 0, current = 0, prev = '';
	for (const { day } of activeDays) {
		if (prev) {
			const diff = (new Date(day).getTime() - new Date(prev).getTime()) / 86400000;
			current = diff === 1 ? current + 1 : 1;
			longest = Math.max(longest, current);
		} else {
			current = 1;
		}
		prev = day;
	}
	longest = Math.max(longest, current);

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
			hours: Math.round(m.total / 3_600_000 * 10) / 10
		}))
	};
}
