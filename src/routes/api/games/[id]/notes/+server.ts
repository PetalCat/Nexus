import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { gameNotes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const userId = locals.user?.id;
	if (!userId) throw error(401, 'Not authenticated');

	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');

	const db = getDb();
	const note = db
		.select()
		.from(gameNotes)
		.where(
			and(
				eq(gameNotes.userId, userId),
				eq(gameNotes.romId, params.id),
				eq(gameNotes.serviceId, serviceId)
			)
		)
		.get();

	return json({ note: note ?? null });
};

export const PUT: RequestHandler = async ({ params, url, request, locals }) => {
	const userId = locals.user?.id;
	if (!userId) throw error(401, 'Not authenticated');

	const body = await request.json();
	const content = body.content ?? '';
	const serviceId = body.serviceId ?? url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');

	const db = getDb();
	const now = Date.now();

	const existing = db
		.select()
		.from(gameNotes)
		.where(
			and(
				eq(gameNotes.userId, userId),
				eq(gameNotes.romId, params.id),
				eq(gameNotes.serviceId, serviceId)
			)
		)
		.get();

	if (existing) {
		db.update(gameNotes)
			.set({ content, updatedAt: now })
			.where(eq(gameNotes.id, existing.id))
			.run();
	} else {
		db.insert(gameNotes)
			.values({ userId, romId: params.id, serviceId, content, updatedAt: now })
			.run();
	}

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, url, locals }) => {
	const userId = locals.user?.id;
	if (!userId) throw error(401, 'Not authenticated');

	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');

	const db = getDb();
	db.delete(gameNotes)
		.where(
			and(
				eq(gameNotes.userId, userId),
				eq(gameNotes.romId, params.id),
				eq(gameNotes.serviceId, serviceId)
			)
		)
		.run();

	return json({ ok: true });
};
