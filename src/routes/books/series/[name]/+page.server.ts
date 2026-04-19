import { error } from '@sveltejs/kit';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getDb, schema } from '$lib/db';
import { eq, and } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import type { UnifiedMedia } from '$lib/adapters/types';

type VolState = 'finished' | 'current' | 'branch' | 'unread' | 'missing';
type Volume = {
  book: UnifiedMedia;
  ordinal: number | null;
  state: VolState;
  branchGapYears?: number;
};

export const load: PageServerLoad = async ({ params, locals }) => {
  const seriesName = decodeURIComponent(params.name);

  const calibreConfig = getConfigsForMediaType('book')[0];
  if (!calibreConfig) throw error(404, 'No book service configured');

  const adapter = registry.get(calibreConfig.type);
  if (!adapter?.getServiceData) throw error(500, 'Book service adapter unavailable');

  const userId = locals.user?.id;
  const userCred = userId ? getUserCredentialForService(userId, calibreConfig.id) ?? undefined : undefined;

  const seriesList = (await adapter.getServiceData(calibreConfig, 'series', {}, userCred) as Array<{ name: string; books: UnifiedMedia[] }>) ?? [];
  const series = seriesList.find(s => s.name === seriesName);
  if (!series || series.books.length === 0) throw error(404, 'Series not found');

  // Sort by seriesIndex then year
  const sorted = [...series.books].sort((a, b) => {
    const ai = (a.metadata?.seriesIndex as number | undefined) ?? 0;
    const bi = (b.metadata?.seriesIndex as number | undefined) ?? 0;
    if (ai !== bi) return ai - bi;
    return (a.year ?? 0) - (b.year ?? 0);
  });

  // Enrich with play_sessions progress
  if (userId) {
    const db = getDb();
    const rows = db.select({
      mediaId: schema.playSessions.mediaId,
      progress: schema.playSessions.progress,
      completed: schema.playSessions.completed
    })
      .from(schema.playSessions)
      .where(and(
        eq(schema.playSessions.userId, userId),
        eq(schema.playSessions.mediaType, 'book'),
        eq(schema.playSessions.serviceId, calibreConfig.id)
      ))
      .all();
    const bySource = new Map<string, { progress: number; completed: boolean }>();
    for (const r of rows) {
      const prev = bySource.get(r.mediaId);
      const next = { progress: r.progress ?? 0, completed: !!r.completed };
      if (!prev || next.progress > prev.progress || (next.completed && !prev.completed)) bySource.set(r.mediaId, next);
    }
    for (const b of sorted) {
      const s = bySource.get(b.sourceId);
      if (!s) continue;
      b.progress = s.progress;
      b.metadata = { ...(b.metadata ?? {}), readStatus: s.completed };
    }
  }

  // Classify volumes + branch detection
  // Note: branch heuristic only applies between consecutive volumes (not vol 0→1).
  // If the very first volume has no predecessor, it can never be 'branch'.
  const volumes: Volume[] = [];
  let lastYear: number | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    const year = b.year ?? 0;
    const gap = lastYear !== null && year > 0 && lastYear > 0 ? year - lastYear : 0;
    let state: VolState;
    if (b.metadata?.readStatus) {
      state = 'finished';
    } else if ((b.progress ?? 0) > 0 && (b.progress ?? 0) < 1) {
      state = 'current';
    } else {
      state = 'unread';
    }
    // Branch: gap >= 3 years between consecutive volumes — overrides unread
    if (gap >= 3 && state === 'unread') state = 'branch';
    volumes.push({
      book: b,
      ordinal: (b.metadata?.seriesIndex as number | undefined) ?? (i + 1),
      state,
      branchGapYears: gap >= 3 ? gap : undefined
    });
    if (year > 0) lastYear = year;
  }

  // Overall progress
  const read = volumes.filter(v => v.state === 'finished').length;
  const yearSpan = sorted.length
    ? { first: sorted[0].year ?? 0, last: sorted[sorted.length - 1].year ?? 0 }
    : { first: 0, last: 0 };

  const author = (sorted[0].metadata?.author as string | undefined) ?? 'Unknown';

  // totalPages: sum of b.metadata?.pages, skipping undefined
  const totalPages = sorted.reduce((acc, b) => {
    const p = b.metadata?.pages as number | undefined;
    return p !== undefined ? acc + p : acc;
  }, 0) || null;

  return {
    seriesName,
    author,
    yearSpan,
    volumes,
    totalVolumes: sorted.length,
    readCount: read,
    totalPages
  };
};
