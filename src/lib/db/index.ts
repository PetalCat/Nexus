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
		user_id TEXT,
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

	db.run(`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT NOT NULL UNIQUE,
		display_name TEXT NOT NULL,
		password_hash TEXT NOT NULL,
		is_admin INTEGER NOT NULL DEFAULT 0,
		auth_provider TEXT NOT NULL DEFAULT 'local',
		external_id TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS sessions (
		token TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		expires_at TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS user_service_credentials (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		access_token TEXT,
		external_user_id TEXT,
		external_username TEXT,
		linked_at TEXT NOT NULL DEFAULT (datetime('now')),
		UNIQUE(user_id, service_id)
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS invite_links (
		code TEXT PRIMARY KEY,
		created_by TEXT NOT NULL,
		max_uses INTEGER NOT NULL DEFAULT 1,
		uses INTEGER NOT NULL DEFAULT 0,
		expires_at TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	// ── Migrations for existing databases ──────────────────────
	// ALTER TABLE is idempotent-safe: we catch "duplicate column" errors.
	const safeAddColumn = (table: string, col: string, typedef: string) => {
		try {
			db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${typedef}`);
		} catch {
			// Column already exists — ignore
		}
	};

	// users table — added in multi-user update
	safeAddColumn('users', 'auth_provider', "TEXT NOT NULL DEFAULT 'local'");
	safeAddColumn('users', 'external_id', 'TEXT');

	// activity table — added user_id for per-user tracking
	safeAddColumn('activity', 'user_id', 'TEXT');

	// ── Analytics engine tables ──────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS media_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		service_type TEXT NOT NULL,
		event_type TEXT NOT NULL,
		media_id TEXT NOT NULL,
		media_type TEXT NOT NULL,
		media_title TEXT,
		media_year INTEGER,
		media_genres TEXT,
		parent_id TEXT,
		parent_title TEXT,
		position_ticks INTEGER,
		duration_ticks INTEGER,
		play_duration_ms INTEGER,
		device_name TEXT,
		client_name TEXT,
		metadata TEXT,
		timestamp INTEGER NOT NULL,
		ingested_at INTEGER NOT NULL
	)`);

	db.run(`CREATE INDEX IF NOT EXISTS idx_media_events_user_ts ON media_events(user_id, timestamp)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_media_events_user_type_ts ON media_events(user_id, media_type, timestamp)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_media_events_user_event_ts ON media_events(user_id, event_type, timestamp)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_media_events_user_media ON media_events(user_id, media_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_media_events_service_ts ON media_events(service_id, media_id, timestamp)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_media_events_ts ON media_events(timestamp)`);

	db.run(`CREATE TABLE IF NOT EXISTS interaction_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT,
		session_token TEXT,
		event_type TEXT NOT NULL,
		page TEXT,
		target TEXT,
		target_title TEXT,
		referrer TEXT,
		search_query TEXT,
		position TEXT,
		duration_ms INTEGER,
		metadata TEXT,
		timestamp INTEGER NOT NULL
	)`);

	db.run(`CREATE INDEX IF NOT EXISTS idx_interaction_user_ts ON interaction_events(user_id, timestamp)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_interaction_user_event_ts ON interaction_events(user_id, event_type, timestamp)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_interaction_page_ts ON interaction_events(page, timestamp)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_interaction_target_ts ON interaction_events(target, timestamp)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_interaction_session_ts ON interaction_events(session_token, timestamp)`);

	db.run(`CREATE TABLE IF NOT EXISTS user_stats_cache (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		period TEXT NOT NULL,
		media_type TEXT NOT NULL,
		stats TEXT NOT NULL,
		computed_at INTEGER NOT NULL
	)`);

	db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_stats_cache_key ON user_stats_cache(user_id, period, media_type)`);
}

export { schema };
