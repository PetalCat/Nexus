import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, schema } from '$lib/db';
import { eq, and } from 'drizzle-orm';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();
	const existing = db.select().from(schema.bookHighlights)
		.where(and(
			eq(schema.bookHighlights.id, params.highlightId),
			eq(schema.bookHighlights.userId, locals.user.id)
		))
		.get();
	if (!existing) throw error(404);

	db.delete(schema.bookHighlights)
		.where(eq(schema.bookHighlights.id, params.highlightId))
		.run();

	return json({ ok: true });
};
