import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, schema } from '$lib/db';
import { eq, and } from 'drizzle-orm';
import { getEnabledConfigs } from '$lib/server/services';
import { emitMediaEvent } from '$lib/server/analytics';

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
	const { progress, cfi, serviceId } = await request.json();
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
			.set({ progress, completed: progress >= 1, lastActivity: now })
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
				lastActivity: now
			})
			.run();
	}

	emitMediaEvent({
		userId: locals.user.id,
		serviceId: svcId,
		serviceType: 'calibre',
		eventType: 'reading_progress',
		mediaId: params.id,
		mediaType: 'book',
		metadata: { progress, cfi }
	});

	return json({ ok: true });
};
