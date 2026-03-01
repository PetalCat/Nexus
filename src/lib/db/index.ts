import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const DB_PATH = process.env.DATABASE_URL || './nexus.db';

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
	if (!_db) {
		const sqlite = new Database(DB_PATH);
		sqlite.pragma('journal_mode = WAL');
		sqlite.pragma('foreign_keys = ON');
		_db = drizzle(sqlite, { schema });
		initDb(_db);
	}
	return _db;
}

function initDb(db: ReturnType<typeof drizzle>) {
	// Create tables if they don't exist
	db.run(`CREATE TABLE IF NOT EXISTS services (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		url TEXT NOT NULL,
		api_key TEXT,
		username TEXT,
		password TEXT,
		enabled INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS media_items (
		id TEXT PRIMARY KEY,
		source_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		type TEXT NOT NULL,
		title TEXT NOT NULL,
		sort_title TEXT,
		description TEXT,
		poster TEXT,
		backdrop TEXT,
		year INTEGER,
		rating REAL,
		genres TEXT,
		studios TEXT,
		duration INTEGER,
		status TEXT,
		metadata TEXT,
		cached_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS activity (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		media_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		type TEXT NOT NULL,
		progress REAL NOT NULL DEFAULT 0,
		position_ticks INTEGER,
		completed INTEGER NOT NULL DEFAULT 0,
		last_activity TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS requests (
		id TEXT PRIMARY KEY,
		service_id TEXT NOT NULL,
		media_id TEXT,
		title TEXT NOT NULL,
		type TEXT NOT NULL,
		status TEXT NOT NULL,
		requested_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);
}

export { schema };
