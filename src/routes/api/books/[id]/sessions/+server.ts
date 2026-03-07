import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, schema } from '$lib/db';
import { eq, and, desc } from 'drizzle-orm';
import crypto from 'crypto';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();
	const sessions = db.select().from(schema.bookReadingSessions)
		.where(and(
			eq(schema.bookReadingSessions.userId, locals.user.id),
			eq(schema.bookReadingSessions.bookId, params.id)
		))
		.orderBy(desc(schema.bookReadingSessions.startedAt))
		.all();
	return json({ sessions });
};

export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401);
	const { startCfi, endCfi, pagesRead, durationSeconds, serviceId } = await request.json();
	if (!serviceId) throw error(400, 'serviceId required');

	const session = {
		id: crypto.randomUUID(),
		userId: locals.user.id,
		bookId: params.id,
		serviceId,
		startedAt: Date.now(),
		endedAt: endCfi ? Date.now() : null,
		startCfi: startCfi ?? null,
		endCfi: endCfi ?? null,
		pagesRead: pagesRead ?? null,
		durationSeconds: durationSeconds ?? null
	};

	const db = getDb();
	db.insert(schema.bookReadingSessions).values(session).run();
	return json(session, { status: 201 });
};
