import { getRawDb } from '../db';

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

export type PeriodGranularity = 'day' | 'week' | 'month' | 'year' | 'alltime';

interface TimeRange {
	from: number;
	to: number;
	period: string;
}

function pad2(n: number) {
	return String(n).padStart(2, '0');
}

function getISOWeek(date: Date): number {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function currentPeriod(granularity: PeriodGranularity, date = new Date()): TimeRange {
	const y = date.getFullYear();
	const m = date.getMonth();
	const d = date.getDate();

	switch (granularity) {
		case 'day': {
			const start = new Date(y, m, d);
			const end = new Date(y, m, d + 1);
			return { from: start.getTime(), to: end.getTime(), period: `day:${y}-${pad2(m + 1)}-${pad2(d)}` };
		}
		case 'week': {
			const dayOfWeek = date.getDay();
			const monday = new Date(y, m, d - ((dayOfWeek + 6) % 7));
			const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
			const weekNum = getISOWeek(date);
			return { from: monday.getTime(), to: sunday.getTime(), period: `week:${y}-W${pad2(weekNum)}` };
		}
		case 'month': {
			const start = new Date(y, m, 1);
			const end = new Date(y, m + 1, 1);
			return { from: start.getTime(), to: end.getTime(), period: `month:${y}-${pad2(m + 1)}` };
		}
		case 'year': {
			const start = new Date(y, 0, 1);
			const end = new Date(y + 1, 0, 1);
			return { from: start.getTime(), to: end.getTime(), period: `year:${y}` };
		}
		case 'alltime':
			return { from: 0, to: Date.now(), period: 'alltime' };
	}
}

/**
 * Parse a period string like "day:2026-03-04" into a { from, to } time range.
 */
export function parsePeriod(period: string): { from: number; to: number } {
	if (period === 'alltime') return { from: 0, to: Date.now() };

	const colonIdx = period.indexOf(':');
	if (colonIdx === -1) return { from: 0, to: Date.now() };

	const gran = period.substring(0, colonIdx);
	const value = period.substring(colonIdx + 1);

	switch (gran) {
		case 'day': {
			const d = new Date(value);
			return { from: d.getTime(), to: d.getTime() + 86400000 };
		}
		case 'week': {
			const [y, w] = value.split('-W').map(Number);
			const jan1 = new Date(y, 0, 1);
			const dayOffset = (jan1.getDay() + 6) % 7;
			const weekStart = new Date(y, 0, 1 + (w - 1) * 7 - dayOffset);
			return { from: weekStart.getTime(), to: weekStart.getTime() + 7 * 86400000 };
		}
		case 'month': {
			const [y, m] = value.split('-').map(Number);
			return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() };
		}
		case 'year': {
			const y = parseInt(value);
			return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() };
		}
		default:
			return { from: 0, to: Date.now() };
	}
}

// ---------------------------------------------------------------------------
// Stats computation
// ---------------------------------------------------------------------------

export interface ComputedStats {
	totalPlayTimeMs: number;
	totalItems: number;
	totalSessions: number;
	completions: number;
	avgSessionLengthMs: number;
	longestSessionMs: number;

	topItems: { mediaId: string; title: string; mediaType: string; playTimeMs: number; sessions: number }[];
	topGenres: { genre: string; playTimeMs: number; count: number; pct: number }[];

	resolutionBreakdown: Record<string, number>;
	hdrBreakdown: Record<string, number>;
	transcodeRate: number;
	subtitleUsage: number;

	topDevices: { name: string; playTimeMs: number; sessions: number }[];
	topClients: { name: string; playTimeMs: number; sessions: number }[];

	totalLikes: number;
	totalRatings: number;
	totalFavorites: number;

	hourlyDistribution: number[];
	weekdayDistribution: number[];

	streaks: { current: number; longest: number };
	avgCompletionRate: number;

	totalPageViews: number;
	totalTimeInAppMs: number;
	mostVisitedPages: { page: string; views: number }[];
}

/**
 * Compute stats for a user within a time range, optionally filtered by media type.
 */
export function computeStats(userId: string, from: number, to: number, mediaType?: string): ComputedStats {
	const db = getRawDb();

	const filterByMediaType = Boolean(mediaType) && mediaType !== 'all';
	// Parameterize the media_type filter rather than interpolating user-controllable
	// input into SQL. Callers today funnel trusted-ish values, but the `type` query
	// param on /api/user/stats reaches here directly — defense-in-depth required.
	const sessions = (filterByMediaType
		? db.prepare(`
			SELECT media_id, media_title, media_type, duration_ms, media_duration_ms, media_genres,
			       device_name, client_name, metadata, started_at, completed
			FROM play_sessions
			WHERE user_id = ? AND started_at >= ? AND started_at < ? AND media_type = ?
			ORDER BY started_at ASC
			LIMIT 50000
		`).all(userId, from, to, mediaType)
		: db.prepare(`
			SELECT media_id, media_title, media_type, duration_ms, media_duration_ms, media_genres,
			       device_name, client_name, metadata, started_at, completed
			FROM play_sessions
			WHERE user_id = ? AND started_at >= ? AND started_at < ?
			ORDER BY started_at ASC
			LIMIT 50000
		`).all(userId, from, to)) as any[];

	// Completions from the completed column
	const completions = sessions.filter((s: any) => s.completed === 1).length;

	// Social signals from media_actions
	const actionCounts = db.prepare(`
		SELECT action_type, COUNT(*) as count FROM media_actions
		WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
		GROUP BY action_type
	`).all(userId, from, to) as { action_type: string; count: number }[];

	const actionCountMap = new Map(actionCounts.map((r) => [r.action_type, r.count]));
	const likes = actionCountMap.get('like') ?? 0;
	const ratings = actionCountMap.get('rate') ?? 0;
	const watchlistAdds = actionCountMap.get('watchlist_add') ?? actionCountMap.get('mark_watched') ?? 0;

	// Aggregate
	let totalPlayTimeMs = 0;
	let longestSessionMs = 0;
	const itemMap = new Map<string, { title: string; mediaType: string; playTimeMs: number; sessions: number }>();
	const genreMap = new Map<string, { playTimeMs: number; count: number }>();
	const deviceMap = new Map<string, { playTimeMs: number; sessions: number }>();
	const clientMap = new Map<string, { playTimeMs: number; sessions: number }>();
	const resolutionMap = new Map<string, number>();
	const hdrMap = new Map<string, number>();
	let transcodeCount = 0;
	let subtitleCount = 0;
	const hourly = new Array(24).fill(0);
	const weekday = new Array(7).fill(0);
	const activeDays = new Set<string>();

	for (const row of sessions) {
		const dur = row.duration_ms ?? 0;
		totalPlayTimeMs += dur;
		if (dur > longestSessionMs) longestSessionMs = dur;

		// Item aggregation
		const existing = itemMap.get(row.media_id);
		if (existing) {
			existing.playTimeMs += dur;
			existing.sessions += 1;
		} else {
			itemMap.set(row.media_id, { title: row.media_title ?? row.media_id, mediaType: row.media_type, playTimeMs: dur, sessions: 1 });
		}

		// Genre aggregation
		if (row.media_genres) {
			try {
				const genres: string[] = JSON.parse(row.media_genres);
				for (const g of genres) {
					const ge = genreMap.get(g);
					if (ge) { ge.playTimeMs += dur; ge.count += 1; }
					else genreMap.set(g, { playTimeMs: dur, count: 1 });
				}
			} catch { /* ignore */ }
		}

		// Device/client
		if (row.device_name) {
			const d = deviceMap.get(row.device_name);
			if (d) { d.playTimeMs += dur; d.sessions += 1; }
			else deviceMap.set(row.device_name, { playTimeMs: dur, sessions: 1 });
		}
		if (row.client_name) {
			const c = clientMap.get(row.client_name);
			if (c) { c.playTimeMs += dur; c.sessions += 1; }
			else clientMap.set(row.client_name, { playTimeMs: dur, sessions: 1 });
		}

		// Technical metadata
		if (row.metadata) {
			try {
				const meta = JSON.parse(row.metadata);
				if (meta.resolution) resolutionMap.set(meta.resolution, (resolutionMap.get(meta.resolution) ?? 0) + 1);
				if (meta.hdr) hdrMap.set(meta.hdr, (hdrMap.get(meta.hdr) ?? 0) + 1);
				if (meta.isTranscoding) transcodeCount++;
				if (meta.subtitleLanguage) subtitleCount++;
			} catch { /* ignore */ }
		}

		// Time patterns
		const date = new Date(row.started_at);
		hourly[date.getHours()] += dur;
		weekday[date.getDay()] += dur;
		activeDays.add(`${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`);
	}

	const totalSessions = sessions.length;
	const avgSessionLengthMs = totalSessions > 0 ? totalPlayTimeMs / totalSessions : 0;

	// Completion rate
	const startedItems = new Set(sessions.map((r: any) => r.media_id));
	const avgCompletionRate = startedItems.size > 0 ? completions / startedItems.size : 0;

	// Top lists
	const topItems = [...itemMap.entries()]
		.map(([mediaId, v]) => ({ mediaId, ...v }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs)
		.slice(0, 20);

	const totalGenreTime = [...genreMap.values()].reduce((s, g) => s + g.playTimeMs, 0);
	const topGenres = [...genreMap.entries()]
		.map(([genre, v]) => ({ genre, ...v, pct: totalGenreTime > 0 ? Math.round((v.playTimeMs / totalGenreTime) * 100) : 0 }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs);

	const topDevices = [...deviceMap.entries()]
		.map(([name, v]) => ({ name, ...v }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs)
		.slice(0, 10);

	const topClients = [...clientMap.entries()]
		.map(([name, v]) => ({ name, ...v }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs)
		.slice(0, 10);

	// Resolution/HDR breakdowns
	const totalResolved = [...resolutionMap.values()].reduce((s, n) => s + n, 0);
	const resolutionBreakdown: Record<string, number> = {};
	for (const [k, v] of resolutionMap) resolutionBreakdown[k] = totalResolved > 0 ? Math.round((v / totalResolved) * 100) : 0;

	const totalHdr = [...hdrMap.values()].reduce((s, n) => s + n, 0);
	const hdrBreakdown: Record<string, number> = {};
	for (const [k, v] of hdrMap) hdrBreakdown[k] = totalHdr > 0 ? Math.round((v / totalHdr) * 100) : 0;

	const transcodeRate = totalSessions > 0 ? Math.round((transcodeCount / totalSessions) * 100) : 0;
	const subtitleUsage = totalSessions > 0 ? Math.round((subtitleCount / totalSessions) * 100) : 0;

	// Streaks
	const sortedDays = [...activeDays].sort();
	let longestStreak = 0;
	let streak = 0;
	let currentStreak = 0;
	for (let i = 0; i < sortedDays.length; i++) {
		if (i === 0) {
			streak = 1;
		} else {
			const prev = new Date(sortedDays[i - 1]);
			const curr = new Date(sortedDays[i]);
			const diff = (curr.getTime() - prev.getTime()) / 86400000;
			streak = diff <= 1 ? streak + 1 : 1;
		}
		if (streak > longestStreak) longestStreak = streak;
	}
	if (sortedDays.length > 0) {
		const today = new Date();
		const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
		const yesterday = new Date(today.getTime() - 86400000);
		const yesterdayKey = `${yesterday.getFullYear()}-${pad2(yesterday.getMonth() + 1)}-${pad2(yesterday.getDate())}`;
		const lastDay = sortedDays[sortedDays.length - 1];
		if (lastDay === todayKey || lastDay === yesterdayKey) {
			currentStreak = streak;
		}
	}

	// Interaction stats
	const pageViews = (db.prepare(`
		SELECT COUNT(*) as count FROM interaction_events
		WHERE user_id = ? AND event_type = 'page_view' AND timestamp >= ? AND timestamp <= ?
	`).get(userId, from, to) as any)?.count ?? 0;

	const timeInApp = (db.prepare(`
		SELECT COALESCE(SUM(duration_ms), 0) as total FROM interaction_events
		WHERE user_id = ? AND event_type = 'page_view' AND timestamp >= ? AND timestamp <= ?
	`).get(userId, from, to) as any)?.total ?? 0;

	const topPages = db.prepare(`
		SELECT page, COUNT(*) as views FROM interaction_events
		WHERE user_id = ? AND event_type = 'page_view' AND timestamp >= ? AND timestamp <= ?
		GROUP BY page ORDER BY views DESC LIMIT 10
	`).all(userId, from, to) as { page: string; views: number }[];

	return {
		totalPlayTimeMs,
		totalItems: itemMap.size,
		totalSessions,
		completions,
		avgSessionLengthMs,
		longestSessionMs,
		topItems,
		topGenres,
		resolutionBreakdown,
		hdrBreakdown,
		transcodeRate,
		subtitleUsage,
		topDevices,
		topClients,
		totalLikes: likes,
		totalRatings: ratings,
		totalFavorites: watchlistAdds,
		hourlyDistribution: hourly,
		weekdayDistribution: weekday,
		streaks: { current: currentStreak, longest: longestStreak },
		avgCompletionRate,
		totalPageViews: pageViews,
		totalTimeInAppMs: timeInApp,
		mostVisitedPages: topPages
	};
}

// ---------------------------------------------------------------------------
// Cache writer
// ---------------------------------------------------------------------------

export function buildAndCacheStats(userId: string, granularity: PeriodGranularity, mediaType = 'all'): ComputedStats {
	const range = currentPeriod(granularity);
	const stats = computeStats(userId, range.from, range.to, mediaType);
	const db = getRawDb();
	const now = Date.now();

	db.prepare(`
		INSERT INTO stats_rollups (user_id, period, media_type, stats, computed_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, period, media_type) DO UPDATE SET
			stats = excluded.stats,
			computed_at = excluded.computed_at
	`).run(userId, range.period, mediaType, JSON.stringify(stats), now);

	return stats;
}

/**
 * Get cached stats or compute fresh if stale/missing.
 */
export function getOrComputeStats(
	userId: string,
	period: string,
	mediaType = 'all',
	maxAgeMs = 300_000
): ComputedStats {
	const db = getRawDb();
	const cached = db.prepare(`
		SELECT stats, computed_at FROM stats_rollups
		WHERE user_id = ? AND period = ? AND media_type = ?
	`).get(userId, period, mediaType) as { stats: string; computed_at: number } | undefined;

	if (cached && (Date.now() - cached.computed_at) < maxAgeMs) {
		return JSON.parse(cached.stats);
	}

	const { from, to } = parsePeriod(period);
	const stats = computeStats(userId, from, to, mediaType);
	const now = Date.now();

	db.prepare(`
		INSERT INTO stats_rollups (user_id, period, media_type, stats, computed_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, period, media_type) DO UPDATE SET
			stats = excluded.stats,
			computed_at = excluded.computed_at
	`).run(userId, period, mediaType, JSON.stringify(stats), now);

	return stats;
}

// ---------------------------------------------------------------------------
// Background rebuild helpers
// ---------------------------------------------------------------------------

export function rebuildStatsForUser(userId: string) {
	const mediaTypes = ['all', 'movie', 'show', 'episode', 'book', 'game', 'music'];
	const granularities: PeriodGranularity[] = ['day', 'week', 'month', 'year', 'alltime'];

	for (const mt of mediaTypes) {
		for (const gran of granularities) {
			try {
				buildAndCacheStats(userId, gran, mt);
			} catch (e) {
				console.error(`[stats] Failed to build ${gran}/${mt} for ${userId}:`, e);
			}
		}
	}
}

export function getActiveUserIds(): string[] {
	const db = getRawDb();
	const rows = db.prepare(`SELECT DISTINCT user_id FROM play_sessions`).all() as { user_id: string }[];
	return rows.map((r) => r.user_id);
}
