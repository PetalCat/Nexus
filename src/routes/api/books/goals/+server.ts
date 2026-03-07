import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, schema } from '$lib/db';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();
	const goals = db.select().from(schema.readingGoals)
		.where(eq(schema.readingGoals.userId, locals.user.id))
		.all();
	return json({ goals });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401);
	const { targetBooks, targetPages, period, year, month } = await request.json();
	if (!period || !year) throw error(400, 'period and year required');

	const goal = {
		id: crypto.randomUUID(),
		userId: locals.user.id,
		targetBooks: targetBooks ?? null,
		targetPages: targetPages ?? null,
		period,
		year,
		month: month ?? null
	};

	const db = getDb();
	db.insert(schema.readingGoals).values(goal).run();
	return json(goal, { status: 201 });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401);
	const { id, targetBooks, targetPages } = await request.json();
	if (!id) throw error(400, 'id required');

	const db = getDb();
	const existing = db.select().from(schema.readingGoals)
		.where(and(
			eq(schema.readingGoals.id, id),
			eq(schema.readingGoals.userId, locals.user.id)
		))
		.get();
	if (!existing) throw error(404);

	const updates: Record<string, unknown> = {};
	if (targetBooks !== undefined) updates.targetBooks = targetBooks;
	if (targetPages !== undefined) updates.targetPages = targetPages;

	db.update(schema.readingGoals)
		.set(updates)
		.where(eq(schema.readingGoals.id, id))
		.run();

	return json({ ...existing, ...updates });
};
