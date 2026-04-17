import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb, schema } from '$lib/db';
import { eq, and, sql, isNotNull } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();

	// Total completed books
	const completedBooks = db.select({ count: sql<number>`count(distinct ${schema.playSessions.mediaId})` })
		.from(schema.playSessions)
		.where(and(
			eq(schema.playSessions.userId, locals.user.id),
			eq(schema.playSessions.mediaType, 'book'),
			eq(schema.playSessions.completed, 1)
		))
		.get()?.count ?? 0;

	// Total reading time from closed book sessions (play_sessions is canonical).
	// `pages_read` is not tracked in the unified model, so we report 0 for pages
	// rather than carrying a secondary truth.
	const sessionStats = db.select({
		totalSeconds: sql<number>`coalesce(sum(${schema.playSessions.durationMs}) / 1000, 0)`
	})
		.from(schema.playSessions)
		.where(and(
			eq(schema.playSessions.userId, locals.user.id),
			eq(schema.playSessions.mediaType, 'book'),
			isNotNull(schema.playSessions.endedAt)
		))
		.get();

	// Monthly breakdown (last 12 months) — groups on started_at.
	const monthlyBreakdown = db.select({
		month: sql<string>`strftime('%Y-%m', ${schema.playSessions.startedAt} / 1000, 'unixepoch')`,
		pages: sql<number>`0`,
		sessions: sql<number>`count(*)`,
		readingTime: sql<number>`coalesce(sum(${schema.playSessions.durationMs}) / 1000, 0)`
	})
		.from(schema.playSessions)
		.where(and(
			eq(schema.playSessions.userId, locals.user.id),
			eq(schema.playSessions.mediaType, 'book'),
			isNotNull(schema.playSessions.endedAt)
		))
		.groupBy(sql`strftime('%Y-%m', ${schema.playSessions.startedAt} / 1000, 'unixepoch')`)
		.orderBy(sql`strftime('%Y-%m', ${schema.playSessions.startedAt} / 1000, 'unixepoch') desc`)
		.limit(12)
		.all();

	// Reading streak: consecutive days with closed sessions.
	const recentDays = db.select({
		day: sql<string>`distinct strftime('%Y-%m-%d', ${schema.playSessions.startedAt} / 1000, 'unixepoch')`
	})
		.from(schema.playSessions)
		.where(and(
			eq(schema.playSessions.userId, locals.user.id),
			eq(schema.playSessions.mediaType, 'book'),
			isNotNull(schema.playSessions.endedAt)
		))
		.orderBy(sql`strftime('%Y-%m-%d', ${schema.playSessions.startedAt} / 1000, 'unixepoch') desc`)
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
		totalPages: 0,
		totalReadingTimeSeconds: sessionStats?.totalSeconds ?? 0,
		currentStreak: streak,
		monthlyBreakdown
	});
};
