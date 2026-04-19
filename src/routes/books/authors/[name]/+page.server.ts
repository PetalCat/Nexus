import { error } from '@sveltejs/kit';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getDb, schema } from '$lib/db';
import { eq, and } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import type { UnifiedMedia } from '$lib/adapters/types';

type HL = typeof schema.bookHighlights.$inferSelect;
type BookWithState = UnifiedMedia & { __state?: 'finished' | 'in-flight' | 'unread' };

export const load: PageServerLoad = async ({ params, locals }) => {
  const authorName = decodeURIComponent(params.name);

  const calibreConfig = getConfigsForMediaType('book')[0];
  if (!calibreConfig) throw error(404, 'No book service configured');

  const adapter = registry.get(calibreConfig.type);
  if (!adapter?.getServiceData) throw error(500, 'Book service adapter unavailable');

  const userId = locals.user?.id;
  const userCred = userId ? getUserCredentialForService(userId, calibreConfig.id) ?? undefined : undefined;

  // All books and filter by author
  const allBooks = (await adapter.getServiceData(calibreConfig, 'all', {}, userCred) as UnifiedMedia[]) ?? [];
  const authorBooks = allBooks.filter(b => (b.metadata?.author as string | undefined) === authorName) as BookWithState[];
  if (authorBooks.length === 0) throw error(404, 'Author not found');

  // Sort by year descending
  authorBooks.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  // Enrich with play_sessions
  if (userId) {
    const db = getDb();
    const sessions = db.select({
      mediaId: schema.playSessions.mediaId,
      progress: schema.playSessions.progress,
      completed: schema.playSessions.completed,
      durationMs: schema.playSessions.durationMs
    })
      .from(schema.playSessions)
      .where(and(
        eq(schema.playSessions.userId, userId),
        eq(schema.playSessions.mediaType, 'book'),
        eq(schema.playSessions.serviceId, calibreConfig.id)
      ))
      .all();

    const bySource = new Map<string, { progress: number; completed: boolean; durationMs: number }>();
    for (const s of sessions) {
      const prev = bySource.get(s.mediaId) ?? { progress: 0, completed: false, durationMs: 0 };
      bySource.set(s.mediaId, {
        progress: Math.max(prev.progress, s.progress ?? 0),
        completed: prev.completed || !!s.completed,
        durationMs: prev.durationMs + (s.durationMs ?? 0)
      });
    }

    for (const b of authorBooks) {
      const s = bySource.get(b.sourceId);
      if (!s) { b.__state = 'unread'; continue; }
      b.progress = s.progress;
      b.metadata = { ...(b.metadata ?? {}), readStatus: s.completed };
      b.__state = s.completed ? 'finished' : (s.progress > 0 ? 'in-flight' : 'unread');
    }
  } else {
    for (const b of authorBooks) b.__state = 'unread';
  }

  // Aggregate reading time across this author's books
  let totalReadingMs = 0;
  let totalHighlights = 0;
  let pullQuote: { text: string; bookTitle: string; chapter?: string } | null = null;

  if (userId) {
    const db = getDb();
    const bookIds = authorBooks.map(b => b.sourceId);
    if (bookIds.length > 0) {
      // Sum durationMs across all author's books
      const allSessions = db.select({ mediaId: schema.playSessions.mediaId, durationMs: schema.playSessions.durationMs })
        .from(schema.playSessions)
        .where(and(
          eq(schema.playSessions.userId, userId),
          eq(schema.playSessions.mediaType, 'book'),
          eq(schema.playSessions.serviceId, calibreConfig.id)
        ))
        .all();
      totalReadingMs = allSessions.filter(s => bookIds.includes(s.mediaId)).reduce((a, s) => a + (s.durationMs ?? 0), 0);

      // Highlights across all author's books
      const highlights: HL[] = db.select().from(schema.bookHighlights)
        .where(and(
          eq(schema.bookHighlights.userId, userId),
          eq(schema.bookHighlights.serviceId, calibreConfig.id)
        ))
        .all();
      const authorHighlights = highlights.filter(h => bookIds.includes(h.bookId));
      totalHighlights = authorHighlights.length;
      // Pick the most recent highlight with a note attached as the pull quote; fall back to the most recent overall.
      const withNote = authorHighlights.filter(h => h.note).sort((a, b) => b.createdAt - a.createdAt);
      const pick = withNote[0] ?? authorHighlights.sort((a, b) => b.createdAt - a.createdAt)[0];
      if (pick) {
        const b = authorBooks.find(bk => bk.sourceId === pick.bookId);
        pullQuote = { text: pick.text, bookTitle: b?.title ?? '', chapter: pick.chapter ?? undefined };
      }
    }
  }

  // Genres seen across the author's books (for chips + influence matching)
  const genres = Array.from(new Set(authorBooks.flatMap(b => b.genres ?? []))).slice(0, 6);

  // Series groupings
  const seriesMap = new Map<string, BookWithState[]>();
  const standalone: BookWithState[] = [];
  for (const b of authorBooks) {
    const s = b.metadata?.series as string | undefined;
    if (s) {
      if (!seriesMap.has(s)) seriesMap.set(s, []);
      seriesMap.get(s)!.push(b);
    } else {
      standalone.push(b);
    }
  }
  const seriesGroupings = [
    ...Array.from(seriesMap.entries()).map(([name, books]) => ({ name, books })),
    ...(standalone.length ? [{ name: 'Standalone works', books: standalone }] : [])
  ];

  // Influences — other authors in library with overlapping genres
  const authorGenreIndex = new Map<string, Set<string>>();
  for (const b of allBooks) {
    const a = b.metadata?.author as string | undefined;
    if (!a || a === authorName) continue;
    const set = authorGenreIndex.get(a) ?? new Set<string>();
    for (const g of b.genres ?? []) set.add(g);
    authorGenreIndex.set(a, set);
  }
  const ourGenres = new Set(genres);
  const influences = Array.from(authorGenreIndex.entries())
    .map(([name, g]) => ({ name, overlap: Array.from(g).filter(x => ourGenres.has(x)).length, inLibrary: allBooks.filter(b => (b.metadata?.author as string) === name).length }))
    .filter(x => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 5);

  // Bio + dates from Calibre aren't usually present, but try metadata.bio/birth/death
  const bio = (authorBooks[0].metadata?.authorBio as string | undefined) ?? null;
  const birthYear = authorBooks[0].metadata?.authorBirth as number | undefined;
  const deathYear = authorBooks[0].metadata?.authorDeath as number | undefined;

  return {
    authorName,
    bio,
    dates: { birth: birthYear ?? null, death: deathYear ?? null },
    genres,
    booksInLibrary: authorBooks.length,
    totalReadingMs,
    totalHighlights,
    pullQuote,
    seriesGroupings,
    influences
  };
};
