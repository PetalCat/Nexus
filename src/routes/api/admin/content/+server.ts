import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import type { RequestHandler } from './$types';

/**
 * GET /api/admin/content
 * Content summary: counts by type, by service, recent additions, gap counts.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const db = getRawDb();

	const byType = db.prepare(`
		SELECT type, COUNT(*) as count FROM media_items GROUP BY type ORDER BY count DESC
	`).all() as { type: string; count: number }[];

	const byService = db.prepare(`
		SELECT mi.service_id as serviceId, s.name as serviceName, s.type as serviceType, COUNT(*) as count
		FROM media_items mi
		LEFT JOIN services s ON s.id = mi.service_id
		GROUP BY mi.service_id
		ORDER BY count DESC
	`).all() as { serviceId: string; serviceName: string; serviceType: string; count: number }[];

	const recent = db.prepare(`
		SELECT id, title, type, poster, service_id as serviceId, cached_at as cachedAt
		FROM media_items
		ORDER BY cached_at DESC
		LIMIT 20
	`).all() as { id: string; title: string; type: string; poster: string | null; serviceId: string; cachedAt: string }[];

	const missingPoster = (db.prepare(`SELECT COUNT(*) as count FROM media_items WHERE poster IS NULL OR poster = ''`).get() as any)?.count ?? 0;
	const missingDescription = (db.prepare(`SELECT COUNT(*) as count FROM media_items WHERE description IS NULL OR description = ''`).get() as any)?.count ?? 0;
	const totalItems = (db.prepare(`SELECT COUNT(*) as count FROM media_items`).get() as any)?.count ?? 0;

	// Per-type play time from play_sessions
	const playTimeByType = db.prepare(`
		SELECT media_type as type, COALESCE(SUM(duration_ms), 0) as playTimeMs
		FROM play_sessions
		GROUP BY media_type
	`).all() as { type: string; playTimeMs: number }[];

	return json({
		totalItems,
		byType,
		byService,
		recent,
		gaps: { missingPoster, missingDescription },
		playTimeByType
	});
};
