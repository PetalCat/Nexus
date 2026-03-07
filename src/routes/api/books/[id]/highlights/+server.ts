import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, schema } from '$lib/db';
import { eq, and, desc } from 'drizzle-orm';
import crypto from 'crypto';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();
	const highlights = db.select().from(schema.bookHighlights)
		.where(and(
			eq(schema.bookHighlights.userId, locals.user.id),
			eq(schema.bookHighlights.bookId, params.id)
		))
		.orderBy(desc(schema.bookHighlights.createdAt))
		.all();
	return json({ highlights });
};

export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401);
	const { cfi, text, note, color, chapter, serviceId } = await request.json();
	if (!cfi || !text) throw error(400, 'cfi and text required');
	if (!serviceId) throw error(400, 'serviceId required');

	const highlight = {
		id: crypto.randomUUID(),
		userId: locals.user.id,
		bookId: params.id,
		serviceId,
		cfi,
		text,
		note: note ?? null,
		color: color ?? 'yellow',
		chapter: chapter ?? null,
		createdAt: Date.now()
	};

	const db = getDb();
	db.insert(schema.bookHighlights).values(highlight).run();
	return json(highlight, { status: 201 });
};
