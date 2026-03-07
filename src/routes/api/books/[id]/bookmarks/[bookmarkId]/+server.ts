import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, schema } from '$lib/db';
import { eq, and } from 'drizzle-orm';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();
	const existing = db.select().from(schema.bookBookmarks)
		.where(and(
			eq(schema.bookBookmarks.id, params.bookmarkId),
			eq(schema.bookBookmarks.userId, locals.user.id)
		))
		.get();
	if (!existing) throw error(404);

	db.delete(schema.bookBookmarks)
		.where(eq(schema.bookBookmarks.id, params.bookmarkId))
		.run();

	return json({ ok: true });
};
