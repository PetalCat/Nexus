import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import type { RequestHandler } from './$types';

/**
 * GET /api/admin/stats/timeline?days=30
 * Returns daily play time + session counts for the bar chart.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const days = Math.min(parseInt(url.searchParams.get('days') ?? '30') || 30, 90);
	const db = getRawDb();
	const since = Date.now() - days * 86400000;

	const rows = db.prepare(`
		SELECT
			date(timestamp / 1000, 'unixepoch', 'localtime') as date,
			COALESCE(SUM(play_duration_ms), 0) as playTimeMs,
			COUNT(*) as sessions
		FROM media_events
		WHERE event_type = 'play_stop' AND timestamp >= ?
		GROUP BY date
		ORDER BY date ASC
	`).all(since) as { date: string; playTimeMs: number; sessions: number }[];

	return json(rows);
};
