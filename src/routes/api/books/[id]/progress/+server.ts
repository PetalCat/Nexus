import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import {
	getLatestSession,
	upsertPlaySession
} from '$lib/server/play-sessions';

/**
 * Book reader progress endpoint.
 *
 * CANONICAL: writes ONLY to `play_sessions` — the single source of truth for
 * reading progress, resume position, duration, and completion. The legacy
 * `activity` table was dropped 2026-04-17 (migration 0008), and the
 * secondary `book_reading_sessions` detail table was dropped 2026-04-17
 * (migration 0012) once every field it carried was either derivable from
 * `play_sessions` or never populated by the real writer. Reader-side
 * annotations (notes, highlights, bookmarks) live in their own tables —
 * they never shared truth with this endpoint.
 */

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401);
	const serviceId =
		url.searchParams.get('serviceId') ?? getConfigsForMediaType('book')[0]?.id ?? '';
	const row = getLatestSession(locals.user.id, serviceId, params.id);
	if (!row) return json(null);
	return json({
		id: row.id,
		userId: row.user_id,
		mediaId: row.media_id,
		serviceId: row.service_id,
		progress: row.progress,
		position: row.position,
		completed: !!row.completed,
		startedAt: row.started_at,
		endedAt: row.ended_at,
		updatedAt: row.updated_at
	});
};

export const PUT: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401);
	const { progress, cfi, page, serviceId, ended } = await request.json();
	if (typeof progress !== 'number') throw error(400, 'progress required');

	const svcId = serviceId ?? getConfigsForMediaType('book')[0]?.id ?? '';
	const userId = locals.user.id;
	const bookId = params.id;
	const position = cfi ?? (page != null ? String(page) : null);

	upsertPlaySession({
		userId,
		serviceId: svcId,
		serviceType: 'calibre',
		mediaId: bookId,
		mediaType: 'book',
		sessionKey: `reader:${svcId}:${bookId}:${userId}`,
		progress,
		position,
		source: 'reader',
		stopped: ended === true,
		completed: progress >= 1
	});

	return json({ ok: true });
};
