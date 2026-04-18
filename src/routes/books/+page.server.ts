import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getDb, schema } from '$lib/db';
import { eq, and, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import type { UnifiedMedia } from '$lib/adapters/types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user?.id;
	const sortBy = url.searchParams.get('sort') ?? 'title';
	const category = url.searchParams.get('category') ?? '';
	const author = url.searchParams.get('author') ?? '';
	const status = url.searchParams.get('status') ?? '';
	const tab = url.searchParams.get('tab') ?? 'all';

	const empty = { items: [] as UnifiedMedia[], total: 0, sortBy, tab, categories: [] as string[], series: [] as any[], authors: [] as any[], category, author, status, featuredBook: null as UnifiedMedia | null, recentlyAdded: [] as UnifiedMedia[], continueReading: [] as UnifiedMedia[], hasBookService: false, serviceStatus: 'unconfigured' as 'unconfigured' | 'online' | 'offline', serviceError: undefined as string | undefined, readingStats: { booksThisYear: 0, pagesThisMonth: 0, currentStreak: 0 } };

	const calibreConfig = getConfigsForMediaType('book')[0];
	if (!calibreConfig) return empty;

	const userCred = userId ? getUserCredentialForService(userId, calibreConfig.id) ?? undefined : undefined;

	const adapter = registry.get(calibreConfig.type);

	// Ping first so we can distinguish "empty library" from "failed to load".
	// All getServiceData() helpers below swallow errors and return [], so without
	// this check a dead Calibre looks identical to an empty one. (Review item 27.)
	const health = adapter?.ping ? await adapter.ping(calibreConfig) : undefined;
	const serviceStatus: 'online' | 'offline' = health?.online ? 'online' : 'offline';
	const serviceError = health?.online ? undefined : health?.error;

	// Single fetch — all helpers (series, categories, authors) use withCache on the same data
	// Run them in parallel; they share the same underlying cached fetchBooks call.
	// When offline, skip the parallel fetch entirely (avoids 4× wasted timeouts).
	const [allBooksRaw, categoriesRaw, seriesRaw, authorsRaw] = serviceStatus === 'online'
		? await Promise.all([
			adapter?.getServiceData?.(calibreConfig, 'all', {}, userCred),
			adapter?.getServiceData?.(calibreConfig, 'categories', {}, userCred),
			adapter?.getServiceData?.(calibreConfig, 'series', {}, userCred),
			adapter?.getServiceData?.(calibreConfig, 'authors', {}, userCred)
		])
		: [[], [], [], []];
	const allBooks = (allBooksRaw ?? []) as UnifiedMedia[];
	const categories = (categoriesRaw ?? []) as string[];
	const series = (seriesRaw ?? []) as any[];
	const authors = (authorsRaw ?? []) as any[];

	// Sort
	let items = [...allBooks];
	switch (sortBy) {
		case 'title': items.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '')); break;
		case 'year': items.sort((a, b) => (b.year ?? 0) - (a.year ?? 0)); break;
		case 'rating': items.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)); break;
		case 'added': items.sort((a, b) => (parseInt(b.sourceId) || 0) - (parseInt(a.sourceId) || 0)); break;
	}

	// Enrich with per-user reading state from play_sessions (join-on-read).
	// Adapters no longer emit `readStatus`/`progress` for books — that's Nexus
	// state, not Calibre state.
	if (userId) {
		const db = getDb();
		const calibreServiceId = calibreConfig.id;
		const sessionRows = db.select({
			mediaId: schema.playSessions.mediaId,
			progress: schema.playSessions.progress,
			completed: schema.playSessions.completed
		})
			.from(schema.playSessions)
			.where(and(
				eq(schema.playSessions.userId, userId),
				eq(schema.playSessions.mediaType, 'book'),
				eq(schema.playSessions.serviceId, calibreServiceId)
			))
			.all();
		const bySource = new Map<string, { progress: number; completed: boolean }>();
		for (const row of sessionRows) {
			const prev = bySource.get(row.mediaId);
			const next = { progress: row.progress ?? 0, completed: !!row.completed };
			if (!prev || next.progress > prev.progress || (next.completed && !prev.completed)) {
				bySource.set(row.mediaId, next);
			}
		}
		for (const book of items) {
			const s = bySource.get(book.sourceId);
			if (!s) continue;
			book.progress = s.progress;
			book.metadata = { ...(book.metadata ?? {}), readStatus: s.completed };
		}
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

		const booksThisYearRows = db.select({
			mediaId: schema.playSessions.mediaId,
			updatedAt: schema.playSessions.updatedAt
		})
			.from(schema.playSessions)
			.where(and(
				eq(schema.playSessions.userId, userId),
				eq(schema.playSessions.mediaType, 'book'),
				eq(schema.playSessions.completed, 1)
			))
			.all();
		const booksThisYear = new Set(
			booksThisYearRows.filter(r => r.updatedAt >= yearStart).map(r => r.mediaId)
		).size;

		// pages_read is not tracked in the unified play_sessions model; this
		// reports 0 until the reader actually emits a page-delta signal.
		const pagesThisMonth = 0;

		readingStats = { booksThisYear, pagesThisMonth, currentStreak: 0 };
	}

	return {
		items: filtered,
		total: allBooks.length,
		hasBookService: true,
		serviceStatus,
		serviceError,
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
