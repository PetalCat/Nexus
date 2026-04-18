import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import { getServiceConfig } from '$lib/server/services';
import { resolveHistoryPoster } from '$lib/server/history-thumbnails';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats/events?type=movie&from=...&to=...&limit=50&offset=0
 * Returns play sessions for the user.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const mediaType = url.searchParams.get('type') ?? undefined;
	const from = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!) : undefined;
	const to = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!) : undefined;
	const serviceId = url.searchParams.get('serviceId') ?? undefined;
	const titleSearch = url.searchParams.get('titleSearch') ?? undefined;
	const limit = Math.min(500, parseInt(url.searchParams.get('limit') ?? '50'));
	const offset = parseInt(url.searchParams.get('offset') ?? '0');

	const db = getRawDb();
	const conditions = ['user_id = ?'];
	const params: (string | number)[] = [locals.user.id];

	if (mediaType) { conditions.push('media_type = ?'); params.push(mediaType); }
	if (from) { conditions.push('started_at >= ?'); params.push(from); }
	if (to) { conditions.push('started_at <= ?'); params.push(to); }
	if (serviceId) { conditions.push('service_id = ?'); params.push(serviceId); }
	if (titleSearch) { conditions.push('media_title LIKE ?'); params.push(`%${titleSearch}%`); }

	const where = conditions.join(' AND ');

	const rows = db.prepare(
		`SELECT id, user_id as userId, service_id as serviceId, service_type as serviceType,
		        media_id as mediaId, media_type as mediaType, media_title as mediaTitle,
		        started_at as timestamp, duration_ms as durationMs,
		        media_duration_ms as mediaDurationMs, progress, completed,
		        device_name as deviceName, client_name as clientName
		 FROM play_sessions WHERE ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`
	).all(...params, limit, offset) as any[];

	const events = rows.map((e) => ({
		...e,
		poster: resolveHistoryPoster({
			serviceId: e.serviceId,
			serviceType: e.serviceType,
			mediaId: e.mediaId,
			mediaType: e.mediaType,
			serviceUrl: getServiceConfig(e.serviceId)?.url
		})
	}));

	const totalRow = db.prepare(
		`SELECT COUNT(*) as count FROM play_sessions WHERE ${where}`
	).get(...params) as { count: number };

	return json({ events, total: totalRow.count, limit, offset });
};
