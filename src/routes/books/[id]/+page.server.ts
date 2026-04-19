import { error } from '@sveltejs/kit';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getDb, schema } from '$lib/db';
import { eq, and, desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import type { UnifiedMedia } from '$lib/adapters/types';

type HL = typeof schema.bookHighlights.$inferSelect;

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw error(404, 'Book not found');
  const userId = locals.user.id;

  const calibreConfig = getConfigsForMediaType('book')[0];
  if (!calibreConfig) throw error(404, 'No book service configured');

  const adapter = registry.get(calibreConfig.type);
  if (!adapter?.getItem) throw error(500, 'Book service adapter unavailable');
  const userCred = getUserCredentialForService(userId, calibreConfig.id) ?? undefined;

  const book = await adapter.getItem(calibreConfig, params.id, userCred);
  if (!book) throw error(404, 'Book not found');

  // Enrich with per-user reading state from play_sessions
  const db = getDb();
  const sessions = db.select({
    startedAt: schema.playSessions.startedAt,
    endedAt: schema.playSessions.endedAt,
    durationMs: schema.playSessions.durationMs,
    updatedAt: schema.playSessions.updatedAt,
    progress: schema.playSessions.progress,
    completed: schema.playSessions.completed
  })
    .from(schema.playSessions)
    .where(and(
      eq(schema.playSessions.userId, userId),
      eq(schema.playSessions.mediaType, 'book'),
      eq(schema.playSessions.mediaId, book.sourceId),
      eq(schema.playSessions.serviceId, calibreConfig.id)
    ))
    .all();

  const sessionsCount = sessions.length;
  const totalReadingMs = sessions.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
  const lastSessionAt = sessions.length ? Math.max(...sessions.map(s => s.updatedAt)) : null;

  const now = Date.now();
  const DAY = 86400_000;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const startOfToday = today.getTime();
  const thisWeekDays = Array<boolean>(7).fill(false);
  for (const s of sessions) {
    if ((s.durationMs ?? 0) < 60_000) continue;
    const idx = Math.floor((s.updatedAt - startOfToday) / DAY) + 6;
    if (idx >= 0 && idx < 7) thisWeekDays[idx] = true;
  }

  // Apply progress from the latest session
  const latest = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (latest) {
    book.progress = latest.progress ?? 0;
    book.metadata = { ...(book.metadata ?? {}), readStatus: !!latest.completed };
  }

  // Author's other books — a single 'all' fetch, filtered by author
  let authorOtherBooks: UnifiedMedia[] = [];
  const author = book.metadata?.author as string | undefined;
  if (author && adapter.getServiceData) {
    try {
      const allBooks = (await adapter.getServiceData(calibreConfig, 'all', {}, userCred) as UnifiedMedia[]) ?? [];
      authorOtherBooks = allBooks
        .filter(b => b.id !== book.id && (b.metadata?.author as string | undefined) === author)
        .slice(0, 6);
    } catch { /* optional */ }
  }

  // Series siblings
  let seriesSiblings: UnifiedMedia[] = [];
  const seriesName = book.metadata?.series as string | undefined;
  if (seriesName && adapter.getServiceData) {
    try {
      const allBooks = (await adapter.getServiceData(calibreConfig, 'all', {}, userCred) as UnifiedMedia[]) ?? [];
      seriesSiblings = allBooks
        .filter(b => (b.metadata?.series as string | undefined) === seriesName)
        .sort((a, b) => ((a.metadata?.seriesIndex as number | undefined) ?? 0) - ((b.metadata?.seriesIndex as number | undefined) ?? 0));
    } catch { /* optional */ }
  }

  // Most recent 3 highlights for this book
  const highlights: HL[] = db.select().from(schema.bookHighlights)
    .where(and(
      eq(schema.bookHighlights.userId, userId),
      eq(schema.bookHighlights.bookId, book.sourceId),
      eq(schema.bookHighlights.serviceId, calibreConfig.id)
    ))
    .orderBy(desc(schema.bookHighlights.createdAt))
    .limit(3)
    .all();

  return {
    book,
    sessionsCount,
    totalReadingMs,
    lastSessionAt,
    thisWeekDays,
    authorOtherBooks,
    seriesSiblings,
    highlights
  };
};
