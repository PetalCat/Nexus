import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
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

	const events = db.prepare(
		`SELECT * FROM play_sessions WHERE ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`
	).all(...params, limit, offset) as any[];

	const totalRow = db.prepare(
		`SELECT COUNT(*) as count FROM play_sessions WHERE ${where}`
	).get(...params) as { count: number };

	return json({ events, total: totalRow.count, limit, offset });
};
