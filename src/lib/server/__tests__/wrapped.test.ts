import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// computeWrapped reads via getRawDb(). Stub that module before importing so
// the helper talks to an in-memory test DB.
let testDb: InstanceType<typeof Database>;

vi.mock('$lib/db', async () => ({
	getRawDb: () => testDb,
	getDb: () => { throw new Error('not used'); }
}));

import { computeWrapped } from '../wrapped';

function seed(db: InstanceType<typeof Database>) {
	db.exec(`
		CREATE TABLE play_sessions (
			id TEXT PRIMARY KEY,
			session_key TEXT,
			user_id TEXT NOT NULL,
			service_id TEXT NOT NULL,
			service_type TEXT NOT NULL,
			media_id TEXT NOT NULL,
			media_type TEXT NOT NULL,
			media_title TEXT,
			media_year INTEGER,
			media_genres TEXT,
			parent_id TEXT,
			parent_title TEXT,
			started_at INTEGER NOT NULL,
			ended_at INTEGER,
			duration_ms INTEGER DEFAULT 0,
			media_duration_ms INTEGER,
			progress REAL,
			completed INTEGER DEFAULT 0,
			position TEXT,
			position_ticks INTEGER,
			device_name TEXT,
			client_name TEXT,
			metadata TEXT,
			source TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
	`);
}

const USER = 'user-fixture';

function insertSession(
	db: InstanceType<typeof Database>,
	id: string,
	startedAt: number,
	durationMs: number,
	opts: Partial<{ mediaType: string; mediaId: string; title: string; genres: string[] }> = {}
) {
	db.prepare(
		`INSERT INTO play_sessions (
			id, user_id, service_id, service_type, media_id, media_type,
			media_title, started_at, duration_ms, source, created_at, updated_at, metadata
		) VALUES (?, ?, 'svc', 'jellyfin', ?, ?, ?, ?, ?, 'test', ?, ?, ?)`
	).run(
		id,
		USER,
		opts.mediaId ?? `media-${id}`,
		opts.mediaType ?? 'movie',
		opts.title ?? 'Fixture',
		startedAt,
		durationMs,
		startedAt,
		startedAt + durationMs,
		opts.genres ? JSON.stringify({ genres: opts.genres }) : null
	);
}

describe('computeWrapped', () => {
	beforeAll(() => {
		testDb = new Database(':memory:');
		seed(testDb);
	});

	beforeEach(() => {
		testDb.exec('DELETE FROM play_sessions');
	});

	it('returns zero hours for a year with no sessions', () => {
		const result = computeWrapped(USER, 2024);
		expect(result.totalHours).toBe(0);
		expect(result.monthlyActivity).toEqual([]);
		expect(result.streaks.longest).toBe(0);
	});

	it('sums duration across sessions within the target year', () => {
		const jan = new Date(2026, 0, 15, 12, 0, 0).getTime();
		const may = new Date(2026, 4, 1, 12, 0, 0).getTime();
		insertSession(testDb, 'a', jan, 60 * 60 * 1000, { mediaType: 'movie', genres: ['drama'] });
		insertSession(testDb, 'b', may, 30 * 60 * 1000, { mediaType: 'show', genres: ['comedy'] });
		// Outside the year — must NOT count.
		insertSession(testDb, 'c', new Date(2025, 11, 30).getTime(), 1000 * 60 * 60, { mediaType: 'movie' });

		const result = computeWrapped(USER, 2026);
		expect(result.totalHours).toBe(1.5);
		expect(result.byType.movie.hours).toBe(1);
		expect(result.byType.show.hours).toBe(0.5);
		// Monthly grouping keys should be proper months like '2026-01', proof
		// that the /1000 epoch conversion is landing.
		expect(result.monthlyActivity.map((m) => m.month)).toEqual(['2026-01', '2026-05']);
	});

	it('computes streak across midnight correctly in user-local time', () => {
		// Three consecutive local days — late-night session on day 1 should
		// still count as day 1, not day 2, thanks to 'localtime'.
		const day1Late = new Date(2026, 1, 10, 23, 30, 0).getTime();
		const day2 = new Date(2026, 1, 11, 10, 0, 0).getTime();
		const day3 = new Date(2026, 1, 12, 15, 0, 0).getTime();
		insertSession(testDb, 'a', day1Late, 30 * 60 * 1000);
		insertSession(testDb, 'b', day2, 30 * 60 * 1000);
		insertSession(testDb, 'c', day3, 30 * 60 * 1000);

		const result = computeWrapped(USER, 2026);
		expect(result.streaks.longest).toBeGreaterThanOrEqual(3);
	});

	it('isolates data by user_id', () => {
		insertSession(testDb, 'a', new Date(2026, 0, 5).getTime(), 60 * 60 * 1000);
		testDb.prepare(
			`INSERT INTO play_sessions (id, user_id, service_id, service_type, media_id, media_type,
			 started_at, duration_ms, source, created_at, updated_at)
			 VALUES ('other', 'other-user', 'svc', 'jellyfin', 'm', 'movie', ?, ?, 'test', ?, ?)`
		).run(new Date(2026, 0, 5).getTime(), 3 * 60 * 60 * 1000, 0, 0);

		const result = computeWrapped(USER, 2026);
		expect(result.totalHours).toBe(1);
	});
});
