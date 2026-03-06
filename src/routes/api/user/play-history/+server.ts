import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import type { RequestHandler } from './$types';

export interface PlaySession {
	id: number;
	date: string;
	duration: number; // minutes
	durationMs: number;
	progressBefore: number | null;
	progressAfter: number | null;
	deviceName: string | null;
	clientName: string | null;
}

/**
 * GET /api/user/play-history?mediaId=xxx&mediaType=game&limit=50&offset=0
 *
 * Returns per-item play sessions built from play_start/play_stop event pairs.
 * Each session = one play_start matched with its next play_stop for the same media.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const mediaId = url.searchParams.get('mediaId');
	const mediaType = url.searchParams.get('mediaType');
	const limit = Math.min(200, parseInt(url.searchParams.get('limit') ?? '50'));
	const offset = parseInt(url.searchParams.get('offset') ?? '0');

	const db = getDb();

	// Build play sessions from play_stop events (which carry duration info)
	const conditions = ['user_id = ?', "event_type = 'play_stop'"];
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

	const sessions = db.all(
		`SELECT id, timestamp, play_duration_ms, position_ticks, duration_ticks,
		        device_name, client_name, media_id, media_title, media_type, service_type
		 FROM media_events
		 WHERE ${where}
		 ORDER BY timestamp DESC
		 LIMIT ? OFFSET ?`,
		...params,
		limit,
		offset
	) as Array<{
		id: number;
		timestamp: number;
		play_duration_ms: number | null;
		position_ticks: number | null;
		duration_ticks: number | null;
		device_name: string | null;
		client_name: string | null;
		media_id: string;
		media_title: string | null;
		media_type: string;
		service_type: string;
	}>;

	const countRow = db.get(
		`SELECT COUNT(*) as count FROM media_events WHERE ${where}`,
		...params
	) as { count: number };

	const result: Array<{
		id: number;
		date: string;
		durationMinutes: number;
		durationMs: number;
		progressPercent: number | null;
		deviceName: string | null;
		clientName: string | null;
		mediaId: string;
		mediaTitle: string | null;
		mediaType: string;
		serviceType: string;
	}> = sessions.map((s) => {
		const durationMs = s.play_duration_ms ?? 0;
		const progressPercent =
			s.position_ticks && s.duration_ticks
				? Math.round((s.position_ticks / s.duration_ticks) * 100)
				: null;

		return {
			id: s.id,
			date: new Date(s.timestamp).toISOString(),
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
