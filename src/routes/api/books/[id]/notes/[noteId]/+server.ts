import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, schema } from '$lib/db';
import { eq, and } from 'drizzle-orm';

export const PUT: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401);
	const { content } = await request.json();
	if (!content) throw error(400, 'content required');

	const db = getDb();
	const existing = db.select().from(schema.bookNotes)
		.where(and(
			eq(schema.bookNotes.id, params.noteId),
			eq(schema.bookNotes.userId, locals.user.id)
		))
		.get();
	if (!existing) throw error(404);

	db.update(schema.bookNotes)
		.set({ content, updatedAt: Date.now() })
		.where(eq(schema.bookNotes.id, params.noteId))
		.run();

	return json({ ...existing, content, updatedAt: Date.now() });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();
	const existing = db.select().from(schema.bookNotes)
		.where(and(
			eq(schema.bookNotes.id, params.noteId),
			eq(schema.bookNotes.userId, locals.user.id)
		))
		.get();
	if (!existing) throw error(404);

	db.delete(schema.bookNotes)
		.where(eq(schema.bookNotes.id, params.noteId))
		.run();

	return json({ ok: true });
};
