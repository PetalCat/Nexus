import { error } from '@sveltejs/kit';
import { getDb, schema } from '$lib/db';
import { eq, desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Login required');
	const db = getDb();
	const userId = locals.user.id;

	const highlights = db.select().from(schema.bookHighlights)
		.where(eq(schema.bookHighlights.userId, userId))
		.orderBy(desc(schema.bookHighlights.createdAt))
		.all();

	const notes = db.select().from(schema.bookNotes)
		.where(eq(schema.bookNotes.userId, userId))
		.orderBy(desc(schema.bookNotes.updatedAt))
		.all();

	return { highlights, notes };
};
