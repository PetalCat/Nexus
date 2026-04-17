import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

let testDb: InstanceType<typeof Database>;

vi.mock('$lib/db', async () => {
	const actual = await vi.importActual<typeof import('$lib/db')>('$lib/db');
	return {
		...actual,
		getDb: () => drizzle(testDb, { schema: actual.schema }),
		getRawDb: () => testDb,
	};
});

vi.mock('../auth', () => ({
	getUserCredentialForService: () => undefined,
}));

// Stub adapter registry: fake adapter returns UnifiedMedia from its mediaId.
vi.mock('$lib/adapters/registry', () => {
	const adapter = {
		getItem: async (cfg: any, sourceId: string) => ({
			sourceId,
			serviceId: cfg.id,
			type: 'movie',
			title: `Item ${sourceId}`,
		}),
		userLinkable: false,
	};
	return {
		registry: {
			get: () => adapter,
		},
	};
});

import { getContinueWatching } from '../continue-watching';

const USER = 'user-fixture';
const SERVICE = { id: 'svc-1', type: 'jellyfin', name: 'jf', url: '', enabled: true } as any;

function createSchema(db: InstanceType<typeof Database>) {
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

function insert(
	db: InstanceType<typeof Database>,
	id: string,
	mediaId: string,
	progress: number | null,
	completed: 0 | 1,
	updatedAt: number
) {
	db.prepare(
		`INSERT INTO play_sessions (
			id, user_id, service_id, service_type, media_id, media_type,
			progress, completed, source, created_at, updated_at, started_at
		) VALUES (?, ?, 'svc-1', 'jellyfin', ?, 'movie', ?, ?, 'test', ?, ?, ?)`
	).run(id, USER, mediaId, progress, completed, updatedAt, updatedAt, updatedAt);
}

describe('getContinueWatching', () => {
	beforeEach(() => {
		testDb = new Database(':memory:');
		createSchema(testDb);
	});

	it('returns items ordered by updated_at DESC', async () => {
		insert(testDb, 's1', 'media-a', 0.3, 0, 1000);
		insert(testDb, 's2', 'media-b', 0.5, 0, 3000);
		insert(testDb, 's3', 'media-c', 0.4, 0, 2000);

		const items = await getContinueWatching(USER, { configs: [SERVICE] });
		expect(items.map((i) => i.sourceId)).toEqual(['media-b', 'media-c', 'media-a']);
	});

	it('excludes completed rows', async () => {
		insert(testDb, 's1', 'media-a', 0.95, 1, 1000);
		insert(testDb, 's2', 'media-b', 0.5, 0, 2000);

		const items = await getContinueWatching(USER, { configs: [SERVICE] });
		expect(items.map((i) => i.sourceId)).toEqual(['media-b']);
	});

	it('excludes barely-started rows (progress <= 0.02)', async () => {
		insert(testDb, 's1', 'media-a', 0.01, 0, 1000);
		insert(testDb, 's2', 'media-b', 0.5, 0, 2000);

		const items = await getContinueWatching(USER, { configs: [SERVICE] });
		expect(items.map((i) => i.sourceId)).toEqual(['media-b']);
	});

	it('excludes near-done rows (progress >= 0.9)', async () => {
		insert(testDb, 's1', 'media-a', 0.95, 0, 1000);
		insert(testDb, 's2', 'media-b', 0.5, 0, 2000);

		const items = await getContinueWatching(USER, { configs: [SERVICE] });
		expect(items.map((i) => i.sourceId)).toEqual(['media-b']);
	});

	it('excludes null progress', async () => {
		insert(testDb, 's1', 'media-a', null, 0, 1000);
		insert(testDb, 's2', 'media-b', 0.5, 0, 2000);

		const items = await getContinueWatching(USER, { configs: [SERVICE] });
		expect(items.map((i) => i.sourceId)).toEqual(['media-b']);
	});

	it('stamps canonical progress from play_sessions on resolved items', async () => {
		insert(testDb, 's1', 'media-a', 0.42, 0, 1000);
		const items = await getContinueWatching(USER, { configs: [SERVICE] });
		expect(items[0].progress).toBe(0.42);
	});

	it('dedupes by (serviceId, mediaId), keeping most recent', async () => {
		insert(testDb, 's1', 'media-a', 0.3, 0, 1000);
		insert(testDb, 's2', 'media-a', 0.7, 0, 2000);
		insert(testDb, 's3', 'media-b', 0.5, 0, 1500);

		const items = await getContinueWatching(USER, { configs: [SERVICE] });
		expect(items.map((i) => i.sourceId)).toEqual(['media-a', 'media-b']);
		expect(items[0].progress).toBe(0.7);
	});

	it('honors the limit option', async () => {
		for (let i = 0; i < 10; i++) {
			insert(testDb, `s${i}`, `media-${i}`, 0.5, 0, 1000 + i);
		}
		const items = await getContinueWatching(USER, { configs: [SERVICE], limit: 3 });
		expect(items).toHaveLength(3);
	});
});
