import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getDb, schema } from '$lib/db';
import { eq, and, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import type { UnifiedMedia } from '$lib/adapters/types';
import { computeStreak14, pickCurrentBook, computeYearProgress } from '$lib/server/books/landing';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user?.id;
	const sortBy = url.searchParams.get('sort') ?? 'title';
	const category = url.searchParams.get('category') ?? '';
	const author = url.searchParams.get('author') ?? '';
	const status = url.searchParams.get('status') ?? '';
	const tab = url.searchParams.get('tab') ?? 'all';

	const empty = { items: [] as UnifiedMedia[], total: 0, sortBy, tab, categories: [] as string[], series: [] as any[], authors: [] as any[], category, author, status, featuredBook: null as UnifiedMedia | null, hasBookService: false, serviceStatus: 'unconfigured' as 'unconfigured' | 'online' | 'offline', serviceError: undefined as string | undefined, currentBook: null as UnifiedMedia | null, streak14: Array<boolean>(14).fill(false), yearProgress: { booksThisYear: 0, goal: 40 }, recentHighlight: null as { text: string; bookTitle: string; chapter?: string; bookId: string } | null };

	const calibreConfig = getConfigsForMediaType('book')[0];
	if (!calibreConfig) return empty;

	const userCred = userId ? getUserCredentialForService(userId, calibreConfig.id) ?? undefined : undefined;

	const adapter = registry.get(calibreConfig.type);

	// Ping first so we can distinguish "empty library" from "failed to load".
	// getServiceData() helpers no longer swallow errors (review followup — they
	// used to cache [] on transient failures, blacking out the library for
	// 5 min after recovery). We now catch at this boundary so a mid-request
	// hiccup degrades to an offline page instead of a 500.
	const health = adapter?.ping ? await adapter.ping(calibreConfig) : undefined;
	let serviceStatus: 'online' | 'offline' = health?.online ? 'online' : 'offline';
	let serviceError = health?.online ? undefined : health?.error;

	// Single fetch — all helpers (series, categories, authors) use withCache on the same data
	// Run them in parallel; they share the same underlying cached fetchBooks call.
	// When offline, skip the parallel fetch entirely (avoids 4× wasted timeouts).
	let allBooks: UnifiedMedia[] = [];
	let categories: string[] = [];
	let series: any[] = [];
	let authors: any[] = [];
	if (serviceStatus === 'online') {
		try {
			const [allBooksRaw, categoriesRaw, seriesRaw, authorsRaw] = await Promise.all([
				adapter?.getServiceData?.(calibreConfig, 'all', {}, userCred),
				adapter?.getServiceData?.(calibreConfig, 'categories', {}, userCred),
				adapter?.getServiceData?.(calibreConfig, 'series', {}, userCred),
				adapter?.getServiceData?.(calibreConfig, 'authors', {}, userCred)
			]);
			allBooks = (allBooksRaw ?? []) as UnifiedMedia[];
			categories = (categoriesRaw ?? []) as string[];
			series = (seriesRaw ?? []) as any[];
			authors = (authorsRaw ?? []) as any[];
		} catch (err) {
			// A failure here after a successful ping means Calibre flaked
			// between ping and library fetch. Surface as offline (no cache
			// poisoning — next request re-probes and can recover instantly).
			serviceStatus = 'offline';
			serviceError = err instanceof Error ? err.message : String(err);
		}
	}

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

	// Derived fields: currentBook, streak14, yearProgress, recentHighlight
	const now = Date.now();
	let currentBook: UnifiedMedia | null = null;
	let streak14: boolean[] = Array<boolean>(14).fill(false);
	let yearProgress = { booksThisYear: 0, goal: 40 };
	let recentHighlight: { text: string; bookTitle: string; chapter?: string; bookId: string } | null = null;

	if (userId) {
		const db = getDb();
		const fullSessions = db.select({
			mediaId: schema.playSessions.mediaId,
			updatedAt: schema.playSessions.updatedAt,
			durationMs: schema.playSessions.durationMs,
			progress: schema.playSessions.progress,
			completed: schema.playSessions.completed,
			endedAt: schema.playSessions.endedAt
		})
			.from(schema.playSessions)
			.where(and(
				eq(schema.playSessions.userId, userId),
				eq(schema.playSessions.mediaType, 'book'),
				eq(schema.playSessions.serviceId, calibreConfig.id)
			))
			.all();

		streak14 = computeStreak14(fullSessions, now);
		yearProgress = computeYearProgress(fullSessions, now);

		const currentId = pickCurrentBook(fullSessions, now);
		if (currentId) currentBook = allBooks.find(b => b.sourceId === currentId) ?? null;

		if (currentBook && adapter?.getServiceData) {
			try {
				const highlights = await adapter.getServiceData(calibreConfig, 'highlights', { bookId: currentBook.sourceId }, userCred) as any[];
				if (highlights && highlights.length > 0) {
					const h = highlights[0];
					recentHighlight = {
						text: h.text ?? h.quote ?? '',
						bookTitle: currentBook.title,
						chapter: h.chapter,
						bookId: currentBook.id
					};
				}
			} catch { /* highlights are optional */ }
		}
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
		currentBook,
		streak14,
		yearProgress,
		recentHighlight
	};
};
