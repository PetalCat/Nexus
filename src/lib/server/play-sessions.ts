/**
 * Canonical play_sessions writer.
 *
 * Every progress endpoint — movies (Jellyfin/Plex), video (Invidious), books
 * (Calibre reader), games (RomM iframe) — goes through this helper so there
 * is exactly one code path that decides "is this an open session I should
 * update, or a new one I should create?".
 *
 * Session identity:
 *   - Prefer `sessionKey` when the caller can supply a stable idempotent key
 *     (Jellyfin `PlaySessionId`, `'invidious:${videoId}'`, `'reader:${bookId}'`,
 *     `'romm:${userId}:${romId}:${sessionUuid}'`).
 *   - Fall back to `(user_id, service_id, media_id) WHERE ended_at IS NULL`.
 *
 * Time:
 *   - All timestamps are integer unix-ms (matching existing play_sessions).
 *   - `duration_ms` accumulates wall-clock watched/read time across heartbeats.
 */

import { randomBytes } from 'node:crypto';
import { getRawDb } from '$lib/db';

export interface UpsertPlaySessionInput {
	userId: string;
	serviceId: string;
	serviceType: string;
	mediaId: string;
	mediaType: string;
	/** Explicit idempotency key. Preferred when available. */
	sessionKey?: string;
	mediaTitle?: string | null;
	mediaYear?: number | null;
	mediaGenres?: string | null;
	parentId?: string | null;
	parentTitle?: string | null;
	mediaDurationMs?: number | null;
	/** 0-1 float. */
	progress?: number | null;
	/** Jellyfin positionTicks (100ns). Optional. */
	positionTicks?: number | null;
	/** Engine-specific resume token (EPUB CFI, PDF page, etc.). */
	position?: string | null;
	deviceName?: string | null;
	clientName?: string | null;
	/** Free-form metadata; serialized to JSON. */
	metadata?: Record<string, unknown> | null;
	/** Where this upsert came from (`'poller'`, `'reader'`, `'emulator'`, etc.). */
	source: string;
	/** Terminal state markers — when set, the session is closed. */
	completed?: boolean;
	stopped?: boolean;
	/** Override "now" (mostly for tests). */
	now?: number;
}

export interface PlaySessionRow {
	id: string;
	session_key: string | null;
	user_id: string;
	service_id: string;
	service_type: string;
	media_id: string;
	media_type: string;
	started_at: number;
	ended_at: number | null;
	duration_ms: number | null;
	progress: number | null;
	completed: number | null;
	updated_at: number;
	position: string | null;
	position_ticks: number | null;
	[key: string]: unknown;
}

/** Find an open (not ended) session by session_key. */
export function findOpenSessionByKey(sessionKey: string): PlaySessionRow | undefined {
	const db = getRawDb();
	return db
		.prepare(`SELECT * FROM play_sessions WHERE session_key = ? AND ended_at IS NULL`)
		.get(sessionKey) as PlaySessionRow | undefined;
}

/**
 * Find an open session for (user, service, media). The order mirrors what the
 * progress endpoints pass — userId first since it's the most selective.
 */
export function findOpenSession(
	userId: string,
	serviceId: string,
	mediaId: string
): PlaySessionRow | undefined {
	const db = getRawDb();
	return db
		.prepare(
			`SELECT * FROM play_sessions
			 WHERE user_id = ? AND service_id = ? AND media_id = ?
			   AND ended_at IS NULL
			 ORDER BY started_at DESC LIMIT 1`
		)
		.get(userId, serviceId, mediaId) as PlaySessionRow | undefined;
}

/**
 * Idle threshold for auto-closing a stale open session and starting a new one
 * on the next heartbeat. 2h is the legacy book-reader value; applies uniformly
 * now that every media type shares the table.
 */
const IDLE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

function newId(): string {
	return randomBytes(16).toString('hex');
}

function coerceMetadata(m: Record<string, unknown> | null | undefined): string | null {
	if (!m) return null;
	try {
		return JSON.stringify(m);
	} catch {
		return null;
	}
}

/**
 * Upsert a play session. Semantics:
 *
 * - If `sessionKey` matches an open row, update it.
 * - Else if a (user, service, media) open row exists AND the last heartbeat
 *   is within IDLE_THRESHOLD, update it.
 * - Else if a stale open row exists, close it (set ended_at) and start a new
 *   session.
 * - Else insert a brand new session.
 *
 * If `stopped` or `completed` is set, the returned row is closed (`ended_at`
 * set to `now`).
 */
export function upsertPlaySession(input: UpsertPlaySessionInput): PlaySessionRow {
	const db = getRawDb();
	const now = input.now ?? Date.now();
	const progress = input.progress ?? null;
	const completed =
		input.completed === true || (progress != null && progress >= 0.9);
	const terminal = input.stopped === true || completed;

	// Locate an existing open row.
	let open: PlaySessionRow | undefined;
	if (input.sessionKey) {
		open = findOpenSessionByKey(input.sessionKey);
	}
	if (!open) {
		open = findOpenSession(input.userId, input.serviceId, input.mediaId);
	}

	// If the existing open session is stale, close it and start fresh.
	if (open) {
		const lastBeat = open.updated_at ?? open.started_at;
		const staleByTime = now - lastBeat > IDLE_THRESHOLD_MS;
		if (staleByTime && !terminal) {
			db.prepare(
				`UPDATE play_sessions
				 SET ended_at = ?, completed = ?
				 WHERE id = ?`
			).run(
				open.updated_at ?? now,
				(open.progress ?? 0) >= 0.9 ? 1 : 0,
				open.id
			);
			open = undefined;
		}
	}

	const metadata = coerceMetadata(input.metadata);

	if (open) {
		const elapsed = Math.max(0, now - (open.updated_at ?? open.started_at));
		const newDuration = (open.duration_ms ?? 0) + elapsed;
		db.prepare(
			`UPDATE play_sessions SET
				updated_at = ?,
				ended_at = ?,
				duration_ms = ?,
				media_duration_ms = COALESCE(?, media_duration_ms),
				progress = COALESCE(?, progress),
				position = COALESCE(?, position),
				position_ticks = COALESCE(?, position_ticks),
				completed = ?,
				media_title = COALESCE(?, media_title),
				media_year = COALESCE(?, media_year),
				media_genres = COALESCE(?, media_genres),
				parent_id = COALESCE(?, parent_id),
				parent_title = COALESCE(?, parent_title),
				device_name = COALESCE(?, device_name),
				client_name = COALESCE(?, client_name),
				metadata = COALESCE(?, metadata)
			 WHERE id = ?`
		).run(
			now,
			terminal ? now : null,
			newDuration,
			input.mediaDurationMs ?? null,
			progress,
			input.position ?? null,
			input.positionTicks ?? null,
			completed ? 1 : (open.completed ?? 0),
			input.mediaTitle ?? null,
			input.mediaYear ?? null,
			input.mediaGenres ?? null,
			input.parentId ?? null,
			input.parentTitle ?? null,
			input.deviceName ?? null,
			input.clientName ?? null,
			metadata,
			open.id
		);
		return db
			.prepare(`SELECT * FROM play_sessions WHERE id = ?`)
			.get(open.id) as PlaySessionRow;
	}

	// Insert fresh row.
	const id = newId();
	db.prepare(
		`INSERT INTO play_sessions (
			id, session_key, user_id, service_id, service_type,
			media_id, media_type, media_title, media_year, media_genres,
			parent_id, parent_title,
			started_at, ended_at, updated_at, created_at,
			duration_ms, media_duration_ms, progress, position, position_ticks,
			completed, device_name, client_name, metadata, source
		 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		id,
		input.sessionKey ?? null,
		input.userId,
		input.serviceId,
		input.serviceType,
		input.mediaId,
		input.mediaType,
		input.mediaTitle ?? null,
		input.mediaYear ?? null,
		input.mediaGenres ?? null,
		input.parentId ?? null,
		input.parentTitle ?? null,
		now,
		terminal ? now : null,
		now,
		now,
		0,
		input.mediaDurationMs ?? null,
		progress,
		input.position ?? null,
		input.positionTicks ?? null,
		completed ? 1 : 0,
		input.deviceName ?? null,
		input.clientName ?? null,
		metadata,
		input.source
	);
	return db
		.prepare(`SELECT * FROM play_sessions WHERE id = ?`)
		.get(id) as PlaySessionRow;
}

/**
 * Look up the most recent resume session for (user, service, media) — even if
 * already closed. Used by media detail + reader pages to render a resume
 * position.
 */
export function getLatestSession(
	userId: string,
	serviceId: string,
	mediaId: string
): PlaySessionRow | undefined {
	const db = getRawDb();
	return db
		.prepare(
			`SELECT * FROM play_sessions
			 WHERE user_id = ? AND service_id = ? AND media_id = ?
			 ORDER BY updated_at DESC LIMIT 1`
		)
		.get(userId, serviceId, mediaId) as PlaySessionRow | undefined;
}
