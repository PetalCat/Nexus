import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, schema } from '$lib/db';
import { eq, and, desc } from 'drizzle-orm';
import crypto from 'crypto';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();
	const bookmarks = db.select().from(schema.bookBookmarks)
		.where(and(
			eq(schema.bookBookmarks.userId, locals.user.id),
			eq(schema.bookBookmarks.bookId, params.id)
		))
		.orderBy(desc(schema.bookBookmarks.createdAt))
		.all();
	return json({ bookmarks });
};

export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401);
	const { cfi, label, serviceId } = await request.json();
	if (!cfi) throw error(400, 'cfi required');
	if (!serviceId) throw error(400, 'serviceId required');

	const bookmark = {
		id: crypto.randomUUID(),
		userId: locals.user.id,
		bookId: params.id,
		serviceId,
		cfi,
		label: label ?? null,
		createdAt: Date.now()
	};

	const db = getDb();
	db.insert(schema.bookBookmarks).values(bookmark).run();
	return json(bookmark, { status: 201 });
};
