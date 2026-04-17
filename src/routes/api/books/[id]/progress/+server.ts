import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRawDb } from '$lib/db';
import { getConfigsForMediaType } from '$lib/server/services';
import {
	getLatestSession,
	upsertPlaySession,
	findOpenSession
} from '$lib/server/play-sessions';
import { randomBytes } from 'node:crypto';

/**
 * Book reader progress endpoint.
 *
 * Writes ONLY to `play_sessions` (current state: progress, resume position,
 * completion) and — on session close — appends a granular
 * `book_reading_sessions` row for stats.
 *
 * The old `activity` table branch was removed on 2026-04-17 along with the
 * table itself.
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

	// Snapshot the open session BEFORE upserting — so if this call closes it
	// we can write a matching book_reading_sessions row with the right bounds.
	const beforeOpen = findOpenSession(userId, svcId, bookId);

	const row = upsertPlaySession({
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

	// Detail-row for book stats. Closed when either:
	//   - caller sent `{ ended: true }`, OR
	//   - the upsert naturally terminated the session (progress >= 0.9 / stopped).
	const didClose = !!row.ended_at && !!beforeOpen && !beforeOpen.ended_at;
	if (didClose && beforeOpen) {
		try {
			const raw = getRawDb();
			const durationSeconds = Math.max(
				0,
				Math.round(((row.ended_at ?? Date.now()) - beforeOpen.started_at) / 1000)
			);
			raw.prepare(
				`INSERT INTO book_reading_sessions
				   (id, user_id, book_id, service_id, started_at, ended_at,
				    start_cfi, end_cfi, pages_read, duration_seconds)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			).run(
				randomBytes(16).toString('hex'),
				userId,
				bookId,
				svcId,
				beforeOpen.started_at,
				row.ended_at ?? Date.now(),
				beforeOpen.position ?? null,
				position,
				null,
				durationSeconds
			);
		} catch (e) {
			console.error('[books/progress] book_reading_sessions insert failed:', e);
		}
	}

	return json({ ok: true });
};
