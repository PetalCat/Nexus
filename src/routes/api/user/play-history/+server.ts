import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/play-history?mediaId=xxx&mediaType=game&limit=50&offset=0
 *
 * Returns per-item play sessions from the play_sessions table.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const mediaId = url.searchParams.get('mediaId');
	const mediaType = url.searchParams.get('mediaType');
	const limit = Math.min(200, parseInt(url.searchParams.get('limit') ?? '50'));
	const offset = parseInt(url.searchParams.get('offset') ?? '0');

	const db = getRawDb();

	const conditions = ['user_id = ?', 'ended_at IS NOT NULL'];
	const params: (string | number)[] = [locals.user.id];

	if (mediaId) {
		conditions.push('media_id = ?');
		params.push(mediaId);
	}
	if (mediaType) {
		conditions.push('media_type = ?');
		params.push(mediaType);
	}

	const where = conditions.join(' AND ');

	const sessions = db.prepare(
		`SELECT id, media_id, media_title, media_type, service_type,
		        duration_ms, media_duration_ms, device_name, client_name,
		        started_at, ended_at, progress, completed
		 FROM play_sessions
		 WHERE ${where}
		 ORDER BY started_at DESC
		 LIMIT ? OFFSET ?`
	).all(...params, limit, offset) as Array<{
		id: string;
		media_id: string;
		media_title: string | null;
		media_type: string;
		service_type: string;
		duration_ms: number | null;
		media_duration_ms: number | null;
		device_name: string | null;
		client_name: string | null;
		started_at: number;
		ended_at: number | null;
		progress: number | null;
		completed: number | null;
	}>;

	const countRow = db.prepare(
		`SELECT COUNT(*) as count FROM play_sessions WHERE ${where}`
	).get(...params) as { count: number };

	const result = sessions.map((s) => {
		const durationMs = s.duration_ms ?? 0;
		const progressPercent = s.progress != null ? Math.round(s.progress * 100) : null;

		return {
			id: s.id,
			date: new Date(s.started_at).toISOString(),
			durationMinutes: Math.round(durationMs / 60_000),
			durationMs,
			progressPercent,
			deviceName: s.device_name,
			clientName: s.client_name,
			mediaId: s.media_id,
			mediaTitle: s.media_title,
			mediaType: s.media_type,
			serviceType: s.service_type
		};
	});

	return json({ sessions: result, total: countRow.count, limit, offset });
};
