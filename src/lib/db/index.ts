import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const DB_PATH = process.env.DATABASE_URL || './nexus.db';

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: InstanceType<typeof Database> | null = null;

export function getDb() {
	if (!_db) {
		_sqlite = new Database(DB_PATH);
		_sqlite.pragma('journal_mode = WAL');
		_sqlite.pragma('foreign_keys = ON');
		_db = drizzle(_sqlite, { schema });
		initDb(_db);
	}
	return _db;
}

/** Raw better-sqlite3 instance for parameterized queries outside Drizzle ORM */
export function getRawDb(): InstanceType<typeof Database> {
	if (!_sqlite) getDb(); // ensure initialized
	return _sqlite!;
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
	safeAddColumn('users', 'avatar', 'TEXT');
	safeAddColumn('users', 'force_password_reset', 'INTEGER NOT NULL DEFAULT 0');
	safeAddColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");

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

	// ── User favorites ──────────────────────────────────────────
	db.run(`CREATE TABLE IF NOT EXISTS user_favorites (
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
	db.run(`CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id, position)`);
	db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_favorites_unique ON user_favorites(user_id, media_id, service_id)`);

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
}

export { schema };
