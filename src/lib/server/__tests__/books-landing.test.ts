import { describe, it, expect } from 'vitest';
import { computeStreak14, pickCurrentBook, computeYearProgress } from '../books/landing';

describe('books landing derived fields', () => {
  const now = new Date('2026-04-18T12:00:00Z').getTime();

  it('computeStreak14 returns 14 booleans, most-recent last', () => {
    const sessions = [{ updatedAt: now - 86400_000, durationMs: 1800_000 }];
    const strip = computeStreak14(sessions, now);
    expect(strip).toHaveLength(14);
    expect(strip[12]).toBe(true);  // yesterday
    expect(strip[13]).toBe(false); // today
  });

  it('pickCurrentBook returns most recent within 30d', () => {
    const sessions = [
      { mediaId: 'old', updatedAt: now - 40 * 86400_000, endedAt: null, progress: 0.1 },
      { mediaId: 'new', updatedAt: now - 86400_000, endedAt: null, progress: 0.5 }
    ];
    expect(pickCurrentBook(sessions, now)).toBe('new');
  });

  it('pickCurrentBook returns null when all sessions older than 30d', () => {
    const sessions = [{ mediaId: 'x', updatedAt: now - 40 * 86400_000, endedAt: null, progress: 0.1 }];
    expect(pickCurrentBook(sessions, now)).toBeNull();
  });

  it('computeYearProgress counts distinct completed books this year', () => {
    const jan1 = new Date('2026-01-01T00:00:00Z').getTime();
    const sessions = [
      { mediaId: 'a', completed: 1, updatedAt: jan1 + 86400_000 },
      { mediaId: 'a', completed: 1, updatedAt: jan1 + 172800_000 },
      { mediaId: 'b', completed: 1, updatedAt: jan1 + 200000_000 }
    ];
    expect(computeYearProgress(sessions, now).booksThisYear).toBe(2);
  });
});
