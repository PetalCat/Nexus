import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, schema } from '$lib/db';
import { eq, and, sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();

	// Total completed books
	const completedBooks = db.select({ count: sql<number>`count(*)` })
		.from(schema.activity)
		.where(and(
			eq(schema.activity.userId, locals.user.id),
			eq(schema.activity.type, 'read'),
			eq(schema.activity.completed, true)
		))
		.get()?.count ?? 0;

	// Total pages and reading time from sessions
	const sessionStats = db.select({
		totalPages: sql<number>`coalesce(sum(${schema.bookReadingSessions.pagesRead}), 0)`,
		totalSeconds: sql<number>`coalesce(sum(${schema.bookReadingSessions.durationSeconds}), 0)`
	})
		.from(schema.bookReadingSessions)
		.where(eq(schema.bookReadingSessions.userId, locals.user.id))
		.get();

	// Monthly breakdown (last 12 months)
	const monthlyBreakdown = db.select({
		month: sql<string>`strftime('%Y-%m', ${schema.bookReadingSessions.startedAt} / 1000, 'unixepoch')`,
		pages: sql<number>`coalesce(sum(${schema.bookReadingSessions.pagesRead}), 0)`,
		sessions: sql<number>`count(*)`,
		readingTime: sql<number>`coalesce(sum(${schema.bookReadingSessions.durationSeconds}), 0)`
	})
		.from(schema.bookReadingSessions)
		.where(eq(schema.bookReadingSessions.userId, locals.user.id))
		.groupBy(sql`strftime('%Y-%m', ${schema.bookReadingSessions.startedAt} / 1000, 'unixepoch')`)
		.orderBy(sql`strftime('%Y-%m', ${schema.bookReadingSessions.startedAt} / 1000, 'unixepoch') desc`)
		.limit(12)
		.all();

	// Reading streak: consecutive days with sessions
	const recentDays = db.select({
		day: sql<string>`distinct strftime('%Y-%m-%d', ${schema.bookReadingSessions.startedAt} / 1000, 'unixepoch')`
	})
		.from(schema.bookReadingSessions)
		.where(eq(schema.bookReadingSessions.userId, locals.user.id))
		.orderBy(sql`strftime('%Y-%m-%d', ${schema.bookReadingSessions.startedAt} / 1000, 'unixepoch') desc`)
		.limit(365)
		.all();

	let streak = 0;
	const today = new Date();
	for (let i = 0; i < recentDays.length; i++) {
		const expected = new Date(today);
		expected.setDate(expected.getDate() - i);
		const expectedStr = expected.toISOString().slice(0, 10);
		if (recentDays[i].day === expectedStr) {
			streak++;
		} else {
			break;
		}
	}

	return json({
		totalBooksRead: completedBooks,
		totalPages: sessionStats?.totalPages ?? 0,
		totalReadingTimeSeconds: sessionStats?.totalSeconds ?? 0,
		currentStreak: streak,
		monthlyBreakdown
	});
};
