import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import type { RequestHandler } from './$types';

/**
 * GET /api/admin/stats/users
 * Per-user play time summary for admin analytics.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const db = getRawDb();

	const rows = db.prepare(`
		SELECT
			ps.user_id as userId,
			u.display_name as displayName,
			u.username,
			COALESCE(SUM(ps.duration_ms), 0) as totalPlayTimeMs,
			COUNT(*) as totalSessions,
			MAX(ps.started_at) as lastActive
		FROM play_sessions ps
		LEFT JOIN users u ON u.id = ps.user_id
		GROUP BY ps.user_id
		ORDER BY totalPlayTimeMs DESC
	`).all() as { userId: string; displayName: string; username: string; totalPlayTimeMs: number; totalSessions: number; lastActive: number }[];

	return json(rows);
};
