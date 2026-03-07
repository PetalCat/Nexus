import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, schema } from '$lib/db';
import { eq, and, desc } from 'drizzle-orm';
import crypto from 'crypto';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();
	const notes = db.select().from(schema.bookNotes)
		.where(and(
			eq(schema.bookNotes.userId, locals.user.id),
			eq(schema.bookNotes.bookId, params.id)
		))
		.orderBy(desc(schema.bookNotes.createdAt))
		.all();
	return json({ notes });
};

export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401);
	const { content, serviceId } = await request.json();
	if (!content) throw error(400, 'content required');
	if (!serviceId) throw error(400, 'serviceId required');

	const now = Date.now();
	const note = {
		id: crypto.randomUUID(),
		userId: locals.user.id,
		bookId: params.id,
		serviceId,
		content,
		createdAt: now,
		updatedAt: now
	};

	const db = getDb();
	db.insert(schema.bookNotes).values(note).run();
	return json(note, { status: 201 });
};
