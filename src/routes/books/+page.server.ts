import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getAllBooks, getCalibreSeries, getCalibreCategories, getCalibreAuthors } from '$lib/adapters/calibre';
import { getDb, schema } from '$lib/db';
import { eq, and } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import type { UnifiedMedia } from '$lib/adapters/types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user?.id;
	const sortBy = url.searchParams.get('sort') ?? 'title';
	const category = url.searchParams.get('category') ?? '';
	const author = url.searchParams.get('author') ?? '';
	const status = url.searchParams.get('status') ?? '';
	const tab = url.searchParams.get('tab') ?? 'all';

	const empty = { items: [] as UnifiedMedia[], total: 0, sortBy, tab, categories: [] as string[], series: [] as any[], authors: [] as any[], category, author, status, featuredBook: null as UnifiedMedia | null, recentlyAdded: [] as UnifiedMedia[], continueReading: [] as UnifiedMedia[], hasBookService: false, readingStats: { booksThisYear: 0, pagesThisMonth: 0, currentStreak: 0 } };

	const configs = getEnabledConfigs();
	const calibreConfig = configs.find(c => c.type === 'calibre');
	if (!calibreConfig) return empty;

	const userCred = userId ? getUserCredentialForService(userId, calibreConfig.id) ?? undefined : undefined;

	// Single fetch — all helpers (series, categories, authors) use withCache on the same data
	// Run them in parallel; they share the same underlying cached fetchBooks call
	const [allBooks, categories, series, authors] = await Promise.all([
		getAllBooks(calibreConfig, userCred),
		getCalibreCategories(calibreConfig, userCred),
		getCalibreSeries(calibreConfig, userCred),
		getCalibreAuthors(calibreConfig, userCred)
	]);

	// Sort
	let items = [...allBooks];
	switch (sortBy) {
		case 'title': items.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '')); break;
		case 'year': items.sort((a, b) => (b.year ?? 0) - (a.year ?? 0)); break;
		case 'rating': items.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)); break;
		case 'added': items.sort((a, b) => (parseInt(b.sourceId) || 0) - (parseInt(a.sourceId) || 0)); break;
	}

	// Filter
	let filtered = items;
	if (category) filtered = filtered.filter(i => i.genres?.includes(category));
	if (author) filtered = filtered.filter(i => (i.metadata?.author as string) === author);
	if (status === 'read') filtered = filtered.filter(i => i.metadata?.readStatus === true);
	if (status === 'unread') filtered = filtered.filter(i => i.metadata?.readStatus !== true);

	// Hero
	const heroCandidate = filtered.filter(i => i.poster && i.description);
	const featuredBook = heroCandidate.length > 0 ? heroCandidate[Math.floor(Math.random() * heroCandidate.length)] : null;

	// Recently added (by Calibre ID descending)
	const recentlyAdded = [...allBooks]
		.sort((a, b) => (parseInt(b.sourceId) || 0) - (parseInt(a.sourceId) || 0))
		.slice(0, 20);

	// Continue reading
	const continueReading = allBooks.filter(i => i.progress && i.progress > 0 && i.progress < 1);

	// Reading stats
	let readingStats = { booksThisYear: 0, pagesThisMonth: 0, currentStreak: 0 };
	if (userId) {
		const db = getDb();
		const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
		const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

		const booksThisYear = db.select().from(schema.activity)
			.where(and(
				eq(schema.activity.userId, userId),
				eq(schema.activity.type, 'read'),
				eq(schema.activity.completed, true)
			))
			.all()
			.filter(a => new Date(a.lastActivity).getTime() >= yearStart)
			.length;

		const sessionsThisMonth = db.select().from(schema.bookReadingSessions)
			.where(eq(schema.bookReadingSessions.userId, userId))
			.all()
			.filter(s => s.startedAt >= monthStart);

		const pagesThisMonth = sessionsThisMonth.reduce((sum, s) => sum + (s.pagesRead ?? 0), 0);

		readingStats = { booksThisYear, pagesThisMonth, currentStreak: 0 };
	}

	return {
		items: filtered,
		total: allBooks.length,
		hasBookService: true,
		sortBy,
		tab,
		categories,
		series,
		authors,
		category,
		author,
		status,
		featuredBook,
		recentlyAdded,
		continueReading,
		readingStats
	};
};
