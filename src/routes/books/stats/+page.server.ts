import { error } from '@sveltejs/kit';
import { getDb, schema } from '$lib/db';
import { eq, and, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Login required');
	const db = getDb();
	const userId = locals.user.id;

	const booksFinished = db.select({ count: sql<number>`count(distinct ${schema.playSessions.mediaId})` })
		.from(schema.playSessions)
		.where(and(
			eq(schema.playSessions.userId, userId),
			eq(schema.playSessions.mediaType, 'book'),
			eq(schema.playSessions.completed, 1)
		))
		.get();

	const sessions = db.select().from(schema.bookReadingSessions)
		.where(eq(schema.bookReadingSessions.userId, userId))
		.all();

	const totalReadingSeconds = sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
	const totalPagesRead = sessions.reduce((sum, s) => sum + (s.pagesRead ?? 0), 0);

	// Monthly breakdown (last 12 months)
	const monthlyData: { month: string; pages: number; minutes: number }[] = [];
	for (let i = 11; i >= 0; i--) {
		const d = new Date();
		d.setMonth(d.getMonth() - i);
		const mStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
		const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();

		const mSessions = sessions.filter(s => s.startedAt >= mStart && s.startedAt < mEnd);
		monthlyData.push({
			month: d.toLocaleDateString('en', { month: 'short', year: '2-digit' }),
			pages: mSessions.reduce((s, r) => s + (r.pagesRead ?? 0), 0),
			minutes: Math.round(mSessions.reduce((s, r) => s + (r.durationSeconds ?? 0), 0) / 60)
		});
	}

	// Reading streak
	const sessionDays = new Set(sessions.map(s => {
		const d = new Date(s.startedAt);
		return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	}));
	let streak = 0;
	const today = new Date();
	for (let i = 0; i < 365; i++) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		if (sessionDays.has(key)) streak++;
		else if (i > 0) break;
	}

	const goals = db.select().from(schema.readingGoals)
		.where(eq(schema.readingGoals.userId, userId))
		.all();

	const highlightCount = db.select({ count: sql<number>`count(*)` })
		.from(schema.bookHighlights)
		.where(eq(schema.bookHighlights.userId, userId))
		.get();

	// Recent sessions with book info
	const recentSessions = sessions
		.filter(s => s.endedAt)
		.sort((a, b) => (b.startedAt) - (a.startedAt))
		.slice(0, 20);

	return {
		booksFinished: booksFinished?.count ?? 0,
		totalReadingMinutes: Math.round(totalReadingSeconds / 60),
		totalPagesRead,
		currentStreak: streak,
		monthlyData,
		goals,
		highlightCount: highlightCount?.count ?? 0,
		sessionCount: sessions.length,
		recentSessions
	};
};
