import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, getRawDb, schema } from '$lib/db';
import { eq, and } from 'drizzle-orm';
import { getEnabledConfigs } from '$lib/server/services';
import { findOpenSession } from '$lib/server/analytics';
import { randomBytes } from 'crypto';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();
	const row = db.select().from(schema.activity)
		.where(and(
			eq(schema.activity.userId, locals.user.id),
			eq(schema.activity.mediaId, params.id),
			eq(schema.activity.type, 'read')
		))
		.get();
	return json(row ?? null);
};

export const PUT: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401);
	const { progress, cfi, page, serviceId } = await request.json();
	if (typeof progress !== 'number') throw error(400, 'progress required');

	const db = getDb();
	const svcId = serviceId ?? getEnabledConfigs().find(c => c.type === 'calibre')?.id ?? '';

	const existing = db.select().from(schema.activity)
		.where(and(
			eq(schema.activity.userId, locals.user.id),
			eq(schema.activity.mediaId, params.id),
			eq(schema.activity.type, 'read')
		))
		.get();

	const now = new Date().toISOString();
	if (existing) {
		db.update(schema.activity)
			.set({ progress, completed: progress >= 1, lastActivity: now, position: cfi ?? page?.toString() ?? null })
			.where(eq(schema.activity.id, existing.id))
			.run();
	} else {
		db.insert(schema.activity)
			.values({
				userId: locals.user.id,
				mediaId: params.id,
				serviceId: svcId,
				type: 'read',
				progress,
				completed: progress >= 1,
				lastActivity: now,
				position: cfi ?? page?.toString() ?? null
			})
			.run();
	}

	// Upsert book play session
	const userId = locals.user.id;
	const bookId = params.id;
	const nowMs = Date.now();
	const TWO_HOURS = 2 * 60 * 60 * 1000;

	try {
		const raw = getRawDb();
		const open = findOpenSession(userId, bookId, svcId);

		if (open && (nowMs - (open.updated_at ?? open.started_at)) < TWO_HOURS) {
			// Update existing session
			const elapsed = nowMs - (open.updated_at ?? open.started_at);
			raw.prepare(
				`UPDATE play_sessions SET duration_ms = duration_ms + ?, progress = ?, updated_at = ? WHERE id = ?`
			).run(elapsed, progress, nowMs, open.id);
		} else {
			if (open) {
				// Close stale session
				raw.prepare(
					`UPDATE play_sessions SET ended_at = ?, completed = ? WHERE id = ?`
				).run(open.updated_at ?? nowMs, open.progress >= 1.0 ? 1 : 0, open.id);
			}
			// Create new session
			const id = randomBytes(16).toString('hex');
			raw.prepare(
				`INSERT INTO play_sessions (id, user_id, service_id, service_type, media_id, media_type, progress, duration_ms, started_at, updated_at)
				 VALUES (?, ?, ?, 'calibre', ?, 'book', ?, 0, ?, ?)`
			).run(id, userId, svcId, bookId, progress, nowMs, nowMs);
		}
	} catch (e) {
		console.error('[books/progress] Session write failed:', e);
	}

	return json({ ok: true });
};
