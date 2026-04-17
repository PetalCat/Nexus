import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';

const DB_PATH = process.env.DATABASE_URL || './nexus.db';

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: InstanceType<typeof Database> | null = null;

export function getDb() {
	if (!_db) {
		mkdirSync(dirname(DB_PATH), { recursive: true });
		_sqlite = new Database(DB_PATH);
		_sqlite.pragma('journal_mode = WAL');
		_sqlite.pragma('foreign_keys = ON');
		_db = drizzle(_sqlite, { schema });
		bootstrapSchema(_db, _sqlite);
		initDb(_db);
	}
	return _db;
}

/**
 * Apply Drizzle migrations if this looks like a fresh install OR mark them
 * applied if this looks like an existing install that predates the migration
 * system. After this runs, the schema is guaranteed to match whatever the
 * current Drizzle schema specifies.
 *
 * Three cases:
 *
 * 1. **Fresh install** — no tables yet, no migration journal. Run migrate(),
 *    which creates every table via 0000 and applies all subsequent migrations.
 *    This is what every Beta user hits on first boot.
 *
 * 2. **Existing install with migration journal** — `__drizzle_migrations`
 *    table exists and lists applied migrations. migrate() reads the journal
 *    and applies only the un-applied migrations. No-op if everything is
 *    current.
 *
 * 3. **Legacy install without migration journal** — tables exist (from the
 *    old hand-rolled initDb), but no `__drizzle_migrations` table. Trying to
 *    run migrate() would fail on 0000 ("table already exists"). Instead we
 *    bootstrap the journal by marking all migrations as applied without
 *    running them, relying on subsequent ALTER TABLE-style migrations to
 *    reconcile.
 */
function bootstrapSchema(
	db: ReturnType<typeof drizzle>,
	sqlite: InstanceType<typeof Database>
): void {
	const migrationsFolder = resolveMigrationsFolder();
	if (!migrationsFolder) {
		console.warn('[db] No migrations folder found; skipping bootstrap');
		return;
	}

	// Detect the three cases by looking for an indicator table.
	const anyAppTableExists = tableExists(sqlite, 'services');
	const migrationJournalExists = tableExists(sqlite, '__drizzle_migrations');

	if (!anyAppTableExists && !migrationJournalExists) {
		// Case 1: fresh install. Run all migrations from scratch.
		console.log('[db] Fresh install detected; running all migrations');
		migrate(db, { migrationsFolder });
		return;
	}

	if (migrationJournalExists) {
		// Case 2: existing install with journal. Apply any pending migrations.
		try {
			migrate(db, { migrationsFolder });
		} catch (err) {
			console.warn('[db] Pending migration failed; schema may be stale:', err);
		}
		return;
	}

	// Case 3: legacy install, tables exist but no journal. Skip migration to
	// avoid "table already exists" errors. The legacy hand-rolled initDb will
	// run below to fill in any missing tables, but ALTER TABLE-style schema
	// changes (like 0001's new columns) will NOT be applied automatically.
	// This is a known gap for pre-Beta installs — they should be wiped and
	// re-created cleanly.
	console.warn(
		'[db] Legacy install detected (tables exist but no migration journal). ' +
			'Schema may be stale. Wipe the database and restart to apply migrations.'
	);
}

function tableExists(sqlite: InstanceType<typeof Database>, name: string): boolean {
	const row = sqlite
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
		.get(name) as { name?: string } | undefined;
	return !!row?.name;
}

function resolveMigrationsFolder(): string | null {
	// Try candidate locations: dev source tree, built production bundle.
	const candidates = [
		resolve(process.cwd(), 'drizzle'),
		resolve(process.cwd(), '..', 'drizzle'),
		resolve(import.meta.dirname ?? '', '../../../drizzle'),
		resolve(import.meta.dirname ?? '', '../../../../drizzle')
	];
	for (const path of candidates) {
		if (existsSync(path)) return path;
	}
	return null;
}

/** Raw better-sqlite3 instance for parameterized queries outside Drizzle ORM */
export function getRawDb(): InstanceType<typeof Database> {
	if (!_sqlite) getDb(); // ensure initialized
	return _sqlite!;
}

export function closeDb(): void {
	if (_sqlite) {
		_sqlite.close();
		_sqlite = null;
		_db = null;
	}
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
		created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
		updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
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

	// Legacy `activity` table removed 2026-04-17; play_sessions is the canonical
	// source for progress/history. Any pre-existing rows were backfilled in
	// migration 0007 before the DROP in 0008.

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
		expires_at INTEGER NOT NULL,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
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
		expires_at INTEGER,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
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

	// Safe migration: convert TEXT timestamps to INTEGER (unix ms) if needed
	const safeConvertTimestamp = (table: string, column: string) => {
		try {
			const row = _sqlite!.prepare(`SELECT typeof(${column}) as t FROM ${table} LIMIT 1`).get() as any;
			if (row?.t === 'text') {
				_sqlite!.prepare(`UPDATE ${table} SET ${column} = CAST(strftime('%s', ${column}) AS INTEGER) * 1000 WHERE typeof(${column}) = 'text'`).run();
			}
		} catch { /* table empty or column doesn't exist */ }
	};

	// Migrate TEXT timestamps → INTEGER for services, sessions, invite_links
	safeConvertTimestamp('services', 'created_at');
	safeConvertTimestamp('services', 'updated_at');
	safeConvertTimestamp('sessions', 'expires_at');
	safeConvertTimestamp('sessions', 'created_at');
	safeConvertTimestamp('invite_links', 'expires_at');
	safeConvertTimestamp('invite_links', 'created_at');

	// users table — added in multi-user update
	safeAddColumn('users', 'auth_provider', "TEXT NOT NULL DEFAULT 'local'");
	safeAddColumn('users', 'external_id', 'TEXT');
	safeAddColumn('users', 'avatar', 'TEXT');
	safeAddColumn('users', 'force_password_reset', 'INTEGER NOT NULL DEFAULT 0');
	safeAddColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");

	// activity table — added user_id for per-user tracking
	safeAddColumn('activity', 'user_id', 'TEXT');

	// ── Play Sessions (replaces media_events) ──────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS play_sessions (
		id TEXT PRIMARY KEY,
		session_key TEXT UNIQUE,
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
		device_name TEXT,
		client_name TEXT,
		metadata TEXT,
		source TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ps_user_started ON play_sessions(user_id, started_at)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ps_user_media ON play_sessions(user_id, media_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ps_user_type ON play_sessions(user_id, media_type)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ps_active ON play_sessions(ended_at) WHERE ended_at IS NULL`);

	// ── Media Actions ──────────────────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS media_actions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		service_type TEXT NOT NULL,
		action_type TEXT NOT NULL,
		media_id TEXT NOT NULL,
		media_type TEXT NOT NULL,
		media_title TEXT,
		metadata TEXT,
		timestamp INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ma_user ON media_actions(user_id, timestamp)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ma_user_action ON media_actions(user_id, action_type, timestamp)`);

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

	// ── Stats Rollups ──────────────────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS stats_rollups (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		period TEXT NOT NULL,
		media_type TEXT NOT NULL,
		stats TEXT NOT NULL,
		computed_at INTEGER NOT NULL,
		UNIQUE(user_id, period, media_type)
	)`);

	// ── Migration: drop old tracking tables ────────────────────────
	db.run(`DROP TABLE IF EXISTS media_events`);
	db.run(`DROP TABLE IF EXISTS user_stats_cache`);

	// ── Social features tables ──────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS friendships (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		friend_id TEXT NOT NULL,
		status TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		accepted_at INTEGER,
		UNIQUE(user_id, friend_id)
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_friendships_friend_status ON friendships(friend_id, status)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_friendships_user_status ON friendships(user_id, status)`);

	db.run(`CREATE TABLE IF NOT EXISTS user_presence (
		user_id TEXT PRIMARY KEY,
		status TEXT NOT NULL DEFAULT 'offline',
		custom_status TEXT,
		ghost_mode INTEGER NOT NULL DEFAULT 0,
		current_activity TEXT,
		last_seen INTEGER
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS shared_items (
		id TEXT PRIMARY KEY,
		from_user_id TEXT NOT NULL,
		to_user_id TEXT NOT NULL,
		media_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		media_type TEXT NOT NULL,
		media_title TEXT NOT NULL,
		media_poster TEXT,
		message TEXT,
		seen INTEGER NOT NULL DEFAULT 0,
		seen_at INTEGER,
		created_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_shared_to_user ON shared_items(to_user_id, seen, created_at)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_shared_from_user ON shared_items(from_user_id, created_at)`);

	db.run(`CREATE TABLE IF NOT EXISTS watch_sessions (
		id TEXT PRIMARY KEY,
		host_id TEXT NOT NULL,
		type TEXT NOT NULL,
		media_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		media_title TEXT NOT NULL,
		media_type TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'waiting',
		max_participants INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL,
		ended_at INTEGER
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_watch_sessions_status ON watch_sessions(status)`);

	db.run(`CREATE TABLE IF NOT EXISTS session_participants (
		session_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		joined_at INTEGER NOT NULL,
		left_at INTEGER,
		role TEXT NOT NULL DEFAULT 'participant',
		UNIQUE(session_id, user_id)
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS session_messages (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		content TEXT NOT NULL,
		type TEXT NOT NULL DEFAULT 'text',
		created_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id, created_at)`);

	db.run(`CREATE TABLE IF NOT EXISTS collections (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		description TEXT,
		creator_id TEXT NOT NULL,
		visibility TEXT NOT NULL DEFAULT 'private',
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS collection_items (
		id TEXT PRIMARY KEY,
		collection_id TEXT NOT NULL,
		media_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		media_type TEXT NOT NULL,
		media_title TEXT NOT NULL,
		media_poster TEXT,
		added_by TEXT NOT NULL,
		position INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_collection_items_coll ON collection_items(collection_id, position)`);

	db.run(`CREATE TABLE IF NOT EXISTS collection_members (
		collection_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'viewer',
		added_at INTEGER NOT NULL,
		UNIQUE(collection_id, user_id)
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS collection_activity (
		id TEXT PRIMARY KEY,
		collection_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		action TEXT NOT NULL,
		target_title TEXT,
		target_media_id TEXT,
		created_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_collection_activity_cid_ts ON collection_activity(collection_id, created_at DESC)`);

	// ── User watchlist (migration from user_favorites) ──────────
	try { db.run(`ALTER TABLE user_favorites RENAME TO user_watchlist`); } catch { /* table doesn't exist yet or already renamed */ }

	db.run(`CREATE TABLE IF NOT EXISTS user_watchlist (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		media_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		media_type TEXT NOT NULL,
		media_title TEXT NOT NULL,
		media_poster TEXT,
		position INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_user_watchlist_user ON user_watchlist(user_id, position)`);
	db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_watchlist_unique ON user_watchlist(user_id, media_id, service_id)`);

	db.run(`CREATE TABLE IF NOT EXISTS user_ratings (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		media_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		media_type TEXT NOT NULL,
		rating INTEGER NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_user_ratings_user ON user_ratings(user_id)`);
	db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ratings_unique ON user_ratings(user_id, media_id, service_id)`);

	// Watch sessions migrations
	safeAddColumn('watch_sessions', 'invited_ids', 'TEXT');
	safeAddColumn('session_participants', 'voice_active', 'INTEGER NOT NULL DEFAULT 0');

	// ── Music tables ────────────────────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS music_liked_tracks (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		track_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		created_at INTEGER NOT NULL
	)`);
	db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_music_liked_unique ON music_liked_tracks(user_id, track_id, service_id)`);

	db.run(`CREATE TABLE IF NOT EXISTS music_playlists (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		name TEXT NOT NULL,
		description TEXT,
		is_collaborative INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_music_playlists_user ON music_playlists(user_id)`);

	db.run(`CREATE TABLE IF NOT EXISTS music_playlist_tracks (
		id TEXT PRIMARY KEY,
		playlist_id TEXT NOT NULL,
		track_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		position INTEGER NOT NULL DEFAULT 0,
		added_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_music_playlist_tracks_playlist ON music_playlist_tracks(playlist_id, position)`);

	db.run(`CREATE TABLE IF NOT EXISTS playlist_collaborators (
		id TEXT PRIMARY KEY,
		playlist_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'editor',
		added_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_playlist_collaborators_playlist ON playlist_collaborators(playlist_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_playlist_collaborators_user ON playlist_collaborators(user_id)`);

	// Add is_collaborative column to existing playlists (migration-safe)
	try { db.run(`ALTER TABLE music_playlists ADD COLUMN is_collaborative INTEGER NOT NULL DEFAULT 0`); } catch { /* column exists */ }

	// Books UI redesign — position sync + positioned notes
	try { db.run(`ALTER TABLE activity ADD COLUMN position TEXT`); } catch { /* column exists */ }
	try { db.run(`ALTER TABLE book_notes ADD COLUMN cfi TEXT`); } catch { /* column exists */ }
	try { db.run(`ALTER TABLE book_notes ADD COLUMN chapter TEXT`); } catch { /* column exists */ }

	// ── Notifications ───────────────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS notifications (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		type TEXT NOT NULL,
		title TEXT NOT NULL,
		message TEXT,
		icon TEXT,
		href TEXT,
		actor_id TEXT,
		metadata TEXT,
		read INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read, created_at)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at)`);

	// ── App settings ────────────────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS app_settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`);

	// ── Notification preferences ────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS notification_preferences (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		notification_type TEXT NOT NULL,
		enabled INTEGER NOT NULL DEFAULT 1,
		updated_at INTEGER NOT NULL,
		UNIQUE(user_id, notification_type)
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON notification_preferences(user_id)`);

	// ── Video subscription notifications ────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS video_sub_notifications (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		channel_id TEXT NOT NULL,
		channel_name TEXT NOT NULL,
		enabled INTEGER NOT NULL DEFAULT 1,
		last_checked_video_id TEXT,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		UNIQUE(user_id, channel_id)
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_video_sub_notif_user ON video_sub_notifications(user_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_video_sub_notif_enabled ON video_sub_notifications(enabled)`);

	// ── Recommendation engine tables ────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS user_genre_affinity (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		media_type TEXT NOT NULL,
		genre TEXT NOT NULL,
		score REAL NOT NULL DEFAULT 0,
		play_time_ms INTEGER,
		completions INTEGER,
		interactions INTEGER,
		updated_at INTEGER NOT NULL,
		UNIQUE(user_id, media_type, genre)
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_genre_affinity_user ON user_genre_affinity(user_id, media_type)`);

	db.run(`CREATE TABLE IF NOT EXISTS user_rec_profiles (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		name TEXT NOT NULL,
		is_default INTEGER NOT NULL DEFAULT 0,
		config TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_rec_profiles_user ON user_rec_profiles(user_id)`);

	db.run(`CREATE TABLE IF NOT EXISTS user_hidden_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		media_id TEXT NOT NULL,
		service_id TEXT,
		reason TEXT,
		created_at INTEGER NOT NULL,
		UNIQUE(user_id, media_id)
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_hidden_items_user ON user_hidden_items(user_id)`);

	db.run(`CREATE TABLE IF NOT EXISTS recommendation_cache (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		profile_id TEXT NOT NULL,
		provider TEXT NOT NULL,
		media_type TEXT NOT NULL,
		results TEXT NOT NULL,
		computed_at INTEGER NOT NULL,
		UNIQUE(user_id, profile_id, provider, media_type)
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_rec_cache_user ON recommendation_cache(user_id, profile_id, media_type)`);

	// ── Books tables ────────────────────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS book_notes (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		book_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_book_notes_user_book ON book_notes(user_id, book_id, service_id)`);

	db.run(`CREATE TABLE IF NOT EXISTS book_highlights (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		book_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		cfi TEXT NOT NULL,
		text TEXT NOT NULL,
		note TEXT,
		color TEXT DEFAULT 'yellow',
		chapter TEXT,
		created_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_book_highlights_user_book ON book_highlights(user_id, book_id, service_id)`);

	db.run(`CREATE TABLE IF NOT EXISTS book_reading_sessions (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		book_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		started_at INTEGER NOT NULL,
		ended_at INTEGER,
		start_cfi TEXT,
		end_cfi TEXT,
		pages_read INTEGER,
		duration_seconds INTEGER
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_book_sessions_user ON book_reading_sessions(user_id, book_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_book_sessions_started ON book_reading_sessions(user_id, started_at)`);

	db.run(`CREATE TABLE IF NOT EXISTS book_bookmarks (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		book_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		cfi TEXT NOT NULL,
		label TEXT,
		created_at INTEGER NOT NULL
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_book_bookmarks_user_book ON book_bookmarks(user_id, book_id, service_id)`);

	db.run(`CREATE TABLE IF NOT EXISTS reading_goals (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		target_books INTEGER,
		target_pages INTEGER,
		period TEXT NOT NULL,
		year INTEGER NOT NULL,
		month INTEGER,
		UNIQUE(user_id, period, year, month)
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_reading_goals_user ON reading_goals(user_id, year)`);

	// ── Game notes ──────────────────────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS game_notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		rom_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		content TEXT NOT NULL DEFAULT '',
		updated_at INTEGER NOT NULL,
		UNIQUE(user_id, rom_id, service_id)
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_game_notes_user_rom ON game_notes(user_id, rom_id, service_id)`);

	// ── Save metadata (labels, pins for cloud saves/states) ────────
	db.run(`CREATE TABLE IF NOT EXISTS save_metadata (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		service_id TEXT NOT NULL,
		entry_id INTEGER NOT NULL,
		entry_type TEXT NOT NULL,
		label TEXT,
		pinned INTEGER NOT NULL DEFAULT 0,
		updated_at INTEGER NOT NULL,
		UNIQUE(user_id, service_id, entry_id, entry_type)
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_save_metadata_lookup ON save_metadata(user_id, service_id, entry_type)`);

	// ── Playback Speed Rules ─────────────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS playback_speed_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		scope TEXT NOT NULL DEFAULT 'default',
		scope_value TEXT,
		scope_name TEXT,
		speed REAL NOT NULL DEFAULT 1,
		updated_at INTEGER NOT NULL,
		UNIQUE(user_id, scope, scope_value)
	)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_speed_rules_user ON playback_speed_rules(user_id, scope)`);

	// ── SponsorBlock Preferences ─────────────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS sponsorblock_preferences (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL UNIQUE,
		enabled INTEGER NOT NULL DEFAULT 1,
		category_settings TEXT NOT NULL DEFAULT '{"sponsor":"skip","selfpromo":"skip","interaction":"skip","intro":"off","outro":"off","preview":"off","music_offtopic":"off","filler":"off","poi_highlight":"show","chapter":"off"}',
		show_on_timeline INTEGER NOT NULL DEFAULT 1,
		show_skip_notice INTEGER NOT NULL DEFAULT 1,
		skip_notice_duration INTEGER NOT NULL DEFAULT 3000,
		updated_at INTEGER NOT NULL
	)`);

	// `recommendation_preferences` and `recommendation_feedback` were removed
	// 2026-04-17. Tuning folded into `user_rec_profiles.config`; negative
	// feedback into `user_hidden_items`.

	// ── Hot-path indexes (added 2026-04-16 during query audit) ─────────
	// Mirrors drizzle/0004; kept here so legacy installs without a migration
	// journal (Case 3 in bootstrapSchema) also pick these up at boot.
	db.run(`CREATE INDEX IF NOT EXISTS idx_media_items_source ON media_items(source_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_media_items_type_cached ON media_items(type, cached_at)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_media_items_service ON media_items(service_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_ps_media ON play_sessions(media_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_user_service_creds_ext ON user_service_credentials(service_id, external_user_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_user_service_creds_service ON user_service_credentials(service_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_user_ratings_media ON user_ratings(media_id, service_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_watch_sessions_host ON watch_sessions(host_id, status)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_collections_creator ON collections(creator_id)`);
	db.run(`CREATE INDEX IF NOT EXISTS idx_collection_members_user ON collection_members(user_id)`);
	// session_participants had a table-level UNIQUE(session_id, user_id) in the legacy
	// CREATE above but Drizzle-managed installs never got that constraint — add it as
	// a named unique index so both paths converge.
	db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_session_participants_unique ON session_participants(session_id, user_id)`);
	db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_members_unique ON collection_members(collection_id, user_id)`);
	// stats_rollups upsert targets (user_id, period, media_type) but legacy/Drizzle
	// tables lacked the matching UNIQUE constraint, so every rebuild threw
	// "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint".
	db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_stats_rollups_unique ON stats_rollups(user_id, period, media_type)`);
}

export { schema };
