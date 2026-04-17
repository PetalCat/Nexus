import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Service configurations stored locally. The `apiKey`/`username`/`password`
// columns are admin-scoped credentials (whatever the adapter uses for
// install-level management); kept with the short legacy names to avoid
// cascading renames across ~29 runtime callers. Per-user credentials live
// in user_service_credentials.
//
// New columns added 2026-04-14 as part of the adapter contract rework:
// - adminUrlOverride: optional second URL some adapters need (e.g. Streamystats
//   needs a Jellyfin URL to proxy through, separate from its own URL). Replaces
//   the previous username-field abuse.
// - adminCredStaleSince / adminCredLastProbedAt: admin credential health tracking.
export const services = sqliteTable('services', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	type: text('type').notNull(),
	url: text('url').notNull(),
	apiKey: text('api_key'),
	username: text('username'),
	password: text('password'),
	adminUrlOverride: text('admin_url_override'),
	adminCredStaleSince: text('admin_cred_stale_since'),
	adminCredLastProbedAt: text('admin_cred_last_probed_at'),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	createdAt: integer('created_at')
		.notNull()
		.default(sql`(strftime('%s','now') * 1000)`),
	updatedAt: integer('updated_at')
		.notNull()
		.default(sql`(strftime('%s','now') * 1000)`)
});

// Cached unified media items
export const mediaItems = sqliteTable('media_items', {
	id: text('id').primaryKey(), // sourceId:serviceId
	sourceId: text('source_id').notNull(),
	serviceId: text('service_id').notNull(),
	type: text('type').notNull(), // 'movie' | 'show' | 'book' | 'game' | 'music' | 'live' | 'episode' | 'album'
	title: text('title').notNull(),
	sortTitle: text('sort_title'),
	description: text('description'),
	poster: text('poster'),
	backdrop: text('backdrop'),
	year: integer('year'),
	rating: real('rating'),
	genres: text('genres'), // JSON array
	studios: text('studios'), // JSON array
	duration: integer('duration'), // seconds
	status: text('status'), // 'available' | 'requested' | 'downloading' | 'missing'
	metadata: text('metadata'), // JSON blob for service-specific data
	cachedAt: text('cached_at')
		.notNull()
		.default(sql`(datetime('now'))`)
}, (table) => [
	// Lookup by sourceId — hit per recommendation item by trending/social/collaborative
	// providers (was SCAN, now SEARCH).
	index('idx_media_items_source').on(table.sourceId),
	// Candidate scans by type ordered by cached_at — content-based + time-aware providers.
	index('idx_media_items_type_cached').on(table.type, table.cachedAt),
	// Sync/purge paths that iterate one service's items.
	index('idx_media_items_service').on(table.serviceId),
]);

// Per-user credentials for user-level services (Jellyfin, Overseerr, Calibre, etc.)
// See docs/superpowers/specs/2026-04-14-service-account-umbrella-design.md for
// the full data-model rationale and lifecycle rules.
//
// Note on column naming: `managed` and `linkedVia` are legacy fields preserved
// to avoid cascading renames across ~13 runtime callers in one commit. New code
// reads/writes the preferred field names below (nexusManaged is a getter alias
// for managed at the service layer; parentServiceId is the new link target).
export const userServiceCredentials = sqliteTable('user_service_credentials', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	serviceId: text('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),

	// Identity on the remote service.
	externalUserId: text('external_user_id'),
	externalUsername: text('external_username'),

	// Auth material.
	accessToken: text('access_token'),        // SID, token, JWT, whatever the adapter uses
	// AES-256-GCM encrypted via src/lib/server/crypto.ts (`encryptStoredPassword`);
	// nullable; raw plaintext never persists. Enables auto-refresh when set.
	storedPassword: text('stored_password'),
	extraAuth: text('extra_auth'),            // adapter-specific JSON (refresh tokens, device ids, etc.)

	// Management metadata.
	managed: integer('managed', { mode: 'boolean' }).notNull().default(false),  // legacy: maps to nexusManaged
	autoLinked: integer('auto_linked', { mode: 'boolean' }).notNull().default(false),
	linkedVia: text('linked_via'),  // legacy: parent service TYPE, e.g. 'jellyfin'
	parentServiceId: text('parent_service_id').references(() => services.id, { onDelete: 'set null' }),

	// State tracking.
	linkedAt: text('linked_at')
		.notNull()
		.default(sql`(datetime('now'))`),
	staleSince: text('stale_since'),
	lastProbedAt: text('last_probed_at')
}, (table) => [
	uniqueIndex('idx_user_service_creds_unique').on(table.userId, table.serviceId),
	// Session poller resolves (external_user_id → nexus user_id) every tick; login
	// flows look up by (serviceId, externalUserId). Both were SCAN before.
	index('idx_user_service_creds_ext').on(table.serviceId, table.externalUserId),
	// Iterating all credentials for a given service (discover/picker/unclaimed count).
	index('idx_user_service_creds_service').on(table.serviceId),
]);

// Per-user preferences for auto-linking derived services. One row per
// (user, service) pair the user has expressed an opinion about.
export const userAutoLinkPrefs = sqliteTable('user_auto_link_prefs', {
	userId: text('user_id').notNull(),
	serviceId: text('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
	autoLinkEnabled: integer('auto_link_enabled', { mode: 'boolean' }).notNull().default(true),
	preferredParentServiceId: text('preferred_parent_service_id').references(() => services.id, { onDelete: 'set null' }),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`(datetime('now'))`)
}, (table) => [
	uniqueIndex('idx_user_auto_link_prefs_unique').on(table.userId, table.serviceId),
]);

// Plugins the admin has explicitly disabled. Checked by the plugin loader at boot.
export const disabledPlugins = sqliteTable('disabled_plugins', {
	packageName: text('package_name').primaryKey(),
	disabledAt: text('disabled_at')
		.notNull()
		.default(sql`(datetime('now'))`),
	reason: text('reason')
});

// Invite links for user registration
export const inviteLinks = sqliteTable('invite_links', {
	code: text('code').primaryKey(), // unique invite code
	createdBy: text('created_by').notNull(), // admin userId
	maxUses: integer('max_uses').notNull().default(1),
	uses: integer('uses').notNull().default(0),
	expiresAt: integer('expires_at'), // null = never expires; unix ms
	createdAt: integer('created_at')
		.notNull()
		.default(sql`(strftime('%s','now') * 1000)`)
});

// NOTE: the legacy `activity` table was removed on 2026-04-17. `play_sessions`
// is now the single source of truth for progress/history/resume across every
// media type. See migrations 0006-0008 for the backfill + drop.

// Requests (Overseerr sync)
export const requests = sqliteTable('requests', {
	id: text('id').primaryKey(),
	serviceId: text('service_id').notNull(),
	mediaId: text('media_id'),
	title: text('title').notNull(),
	type: text('type').notNull(), // 'movie' | 'tv'
	status: text('status').notNull(), // 'pending' | 'approved' | 'available' | 'declined'
	requestedAt: text('requested_at')
		.notNull()
		.default(sql`(datetime('now'))`),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`(datetime('now'))`)
});

// Nexus users — the app's own user accounts
export const users = sqliteTable('users', {
	id: text('id').primaryKey(), // UUID
	username: text('username').notNull().unique(),
	displayName: text('display_name').notNull(),
	passwordHash: text('password_hash').notNull(),
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	authProvider: text('auth_provider').notNull().default('local'), // 'local' | 'jellyfin'
	externalId: text('external_id'), // e.g. Jellyfin userId for migrated users
	avatar: text('avatar'), // URL or path to profile picture
	forcePasswordReset: integer('force_password_reset', { mode: 'boolean' }).notNull().default(false),
	status: text('status').notNull().default('active'), // 'active' | 'pending'
	// Per-user onboarding flag for the /welcome flow. Null means "never seen
	// the welcome flow yet"; set to an ISO timestamp when the user completes
	// or skips the /welcome wizard. Non-admin users with null welcomeCompletedAt
	// are redirected to /welcome on first login.
	welcomeCompletedAt: text('welcome_completed_at'),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`)
});

// Auth sessions
export const sessions = sqliteTable('sessions', {
	token: text('token').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id),
	expiresAt: integer('expires_at').notNull(),
	createdAt: integer('created_at')
		.notNull()
		.default(sql`(strftime('%s','now') * 1000)`)
}, (table) => [
	// Auth revoke/logout-all deletes by user_id (was SCAN).
	index('idx_sessions_user').on(table.userId),
]);

// ── Play Sessions (canonical progress/temporal truth for every media type) ──
//
// Since 2026-04-17 this table is the ONLY write target for progress across
// movies, shows, books, games, music, and video. The legacy `activity` table
// was dropped in migrations 0006-0008.
//
// `position` (text) and `positionTicks` (int) carry engine-specific resume
// tokens — EPUB CFI + page for books, Jellyfin positionTicks for movies. A
// session is "open" when `ended_at IS NULL`; the progress writers upsert by
// (`session_key`) OR (`user_id`,`media_id`,`service_id`) to keep a single
// open row per item.
export const playSessions = sqliteTable('play_sessions', {
	id: text('id').primaryKey(),
	sessionKey: text('session_key').unique(),
	userId: text('user_id').notNull().references(() => users.id),
	serviceId: text('service_id').notNull(),
	serviceType: text('service_type').notNull(),
	mediaId: text('media_id').notNull(),
	mediaType: text('media_type').notNull(),
	mediaTitle: text('media_title'),
	mediaYear: integer('media_year'),
	mediaGenres: text('media_genres'),
	parentId: text('parent_id'),
	parentTitle: text('parent_title'),
	startedAt: integer('started_at').notNull(),
	endedAt: integer('ended_at'),
	durationMs: integer('duration_ms').default(0),
	mediaDurationMs: integer('media_duration_ms'),
	progress: real('progress'),
	completed: integer('completed').default(0),
	// Engine-specific resume token. EPUB CFI, PDF page number (stringified),
	// or any adapter resume key that isn't a clean 0-1 float.
	position: text('position'),
	// Jellyfin-compat 100ns ticks. Derivable from `progress * mediaDurationMs`
	// but stored directly for round-trip fidelity with the Jellyfin report API.
	positionTicks: integer('position_ticks'),
	deviceName: text('device_name'),
	clientName: text('client_name'),
	metadata: text('metadata'),
	source: text('source').notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
}, (table) => [
	// Trending provider + friend-activity service lookup filter by media_id only
	// (no user_id context). Existing idx_ps_user_media requires user_id as first
	// key so it didn't help here — this is additive.
	index('idx_ps_media').on(table.mediaId),
	// Continue-watching / recent history queries order by (user_id, updated_at DESC).
	index('idx_ps_user_updated').on(table.userId, table.updatedAt),
]);

export type PlaySession = typeof playSessions.$inferSelect;
export type NewPlaySession = typeof playSessions.$inferInsert;

// ── Media Actions (non-playback events: ratings, marks, etc.) ────────
export const mediaActions = sqliteTable('media_actions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	serviceId: text('service_id').notNull(),
	serviceType: text('service_type').notNull(),
	actionType: text('action_type').notNull(),
	mediaId: text('media_id').notNull(),
	mediaType: text('media_type').notNull(),
	mediaTitle: text('media_title'),
	metadata: text('metadata'),
	timestamp: integer('timestamp').notNull()
});

export type MediaAction = typeof mediaActions.$inferSelect;

// Append-only UI/behavioral event log
export const interactionEvents = sqliteTable('interaction_events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id'),
	sessionToken: text('session_token'),
	eventType: text('event_type').notNull(), // page_view, click, search, scroll_depth, card_hover, card_click, row_scroll, filter_change, sort_change, detail_view, request_submit, setting_change, login, logout, like_button, rate_button, watchlist_button
	page: text('page'), // route path
	target: text('target'), // "media_card:movie:456", "sidebar:movies", "search_bar"
	targetTitle: text('target_title'),
	referrer: text('referrer'),
	searchQuery: text('search_query'),
	position: text('position'), // JSON: row index, card index, scroll %, viewport position
	durationMs: integer('duration_ms'),
	metadata: text('metadata'), // JSON: browser, viewport, device type
	timestamp: integer('timestamp').notNull()
});

// ── Stats Rollups (pre-computed for monthly/yearly/alltime) ──────────
export const statsRollups = sqliteTable('stats_rollups', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	period: text('period').notNull(),
	mediaType: text('media_type').notNull(),
	stats: text('stats').notNull(),
	computedAt: integer('computed_at').notNull()
}, (table) => [
	// Required by the ON CONFLICT(user_id, period, media_type) upsert in
	// stats-engine.ts. Without this, every stats rebuild threw "ON CONFLICT
	// clause does not match any PRIMARY KEY or UNIQUE constraint" at runtime
	// and cached stats were never written.
	uniqueIndex('idx_stats_rollups_unique').on(table.userId, table.period, table.mediaType),
]);

export type StatsRollup = typeof statsRollups.$inferSelect;

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type MediaItem = typeof mediaItems.$inferSelect;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type Request = typeof requests.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type UserServiceCredential = typeof userServiceCredentials.$inferSelect;
export type InviteLink = typeof inviteLinks.$inferSelect;
export type InteractionEvent = typeof interactionEvents.$inferSelect;
export type NewInteractionEvent = typeof interactionEvents.$inferInsert;

// ── Social Features ─────────────────────────────────────────────────────

export const friendships = sqliteTable('friendships', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id),
	friendId: text('friend_id').notNull().references(() => users.id),
	status: text('status').notNull(), // 'pending' | 'accepted' | 'blocked'
	createdAt: integer('created_at').notNull(), // unix ms
	acceptedAt: integer('accepted_at') // unix ms, nullable
});

export const userPresence = sqliteTable('user_presence', {
	userId: text('user_id').primaryKey(),
	status: text('status').notNull().default('offline'), // 'online' | 'away' | 'dnd' | 'offline'
	customStatus: text('custom_status'),
	ghostMode: integer('ghost_mode').notNull().default(0),
	currentActivity: text('current_activity'), // JSON
	lastSeen: integer('last_seen') // unix ms
});

export const sharedItems = sqliteTable('shared_items', {
	id: text('id').primaryKey(),
	fromUserId: text('from_user_id').notNull(),
	toUserId: text('to_user_id').notNull(),
	mediaId: text('media_id').notNull(),
	serviceId: text('service_id').notNull(),
	mediaType: text('media_type').notNull(),
	mediaTitle: text('media_title').notNull(),
	mediaPoster: text('media_poster'),
	message: text('message'),
	seen: integer('seen').notNull().default(0),
	seenAt: integer('seen_at'),
	createdAt: integer('created_at').notNull()
});

export const watchSessions = sqliteTable('watch_sessions', {
	id: text('id').primaryKey(),
	hostId: text('host_id').notNull(),
	type: text('type').notNull(), // 'watch_party' | 'listen_party' | 'netplay' | 'co_op'
	mediaId: text('media_id').notNull(),
	serviceId: text('service_id').notNull(),
	mediaTitle: text('media_title').notNull(),
	mediaType: text('media_type').notNull(),
	status: text('status').notNull().default('waiting'), // 'waiting' | 'playing' | 'paused' | 'ended'
	maxParticipants: integer('max_participants').notNull().default(0),
	invitedIds: text('invited_ids'), // JSON array of user IDs invited but not yet joined
	createdAt: integer('created_at').notNull(),
	endedAt: integer('ended_at')
}, (table) => [
	// getActiveSessions filters by host_id IN (friends) AND status != 'ended'.
	index('idx_watch_sessions_host').on(table.hostId, table.status),
]);

export const sessionParticipants = sqliteTable('session_participants', {
	sessionId: text('session_id').notNull(),
	userId: text('user_id').notNull(),
	joinedAt: integer('joined_at').notNull(),
	leftAt: integer('left_at'),
	role: text('role').notNull().default('participant'), // 'host' | 'participant'
	voiceActive: integer('voice_active', { mode: 'boolean' }).notNull().default(false)
}, (table) => [
	// Lookups by session_id (getWatchSession, participant count, join checks).
	// Also doubles as uniqueness guard matching the legacy UNIQUE(session_id, user_id)
	// in initDb (the table existed before schema.ts knew about it).
	uniqueIndex('idx_session_participants_unique').on(table.sessionId, table.userId),
]);

export const sessionMessages = sqliteTable('session_messages', {
	id: text('id').primaryKey(),
	sessionId: text('session_id').notNull(),
	userId: text('user_id').notNull(),
	content: text('content').notNull(),
	type: text('type').notNull().default('text'), // 'text' | 'system' | 'reaction'
	createdAt: integer('created_at').notNull()
});

export const collections = sqliteTable('collections', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	creatorId: text('creator_id').notNull(),
	visibility: text('visibility').notNull().default('private'), // 'private' | 'friends' | 'public'
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
}, (table) => [
	// Social provider joins collection_items → collections on creator_id IN (friends).
	index('idx_collections_creator').on(table.creatorId),
]);

export const collectionItems = sqliteTable('collection_items', {
	id: text('id').primaryKey(),
	collectionId: text('collection_id').notNull(),
	mediaId: text('media_id').notNull(),
	serviceId: text('service_id').notNull(),
	mediaType: text('media_type').notNull(),
	mediaTitle: text('media_title').notNull(),
	mediaPoster: text('media_poster'),
	addedBy: text('added_by').notNull(),
	position: integer('position').notNull().default(0),
	createdAt: integer('created_at').notNull()
});

export const collectionMembers = sqliteTable('collection_members', {
	collectionId: text('collection_id').notNull(),
	userId: text('user_id').notNull().references(() => users.id),
	role: text('role').notNull().default('viewer'), // 'owner' | 'editor' | 'viewer'
	addedAt: integer('added_at').notNull()
}, (table) => [
	// getUserCollections + permission checks query by (collection_id, user_id).
	// Also serves getUserCollections' SELECT ... WHERE user_id = ? enumeration.
	uniqueIndex('idx_collection_members_unique').on(table.collectionId, table.userId),
	index('idx_collection_members_user').on(table.userId),
]);

export type Friendship = typeof friendships.$inferSelect;
export type UserPresence = typeof userPresence.$inferSelect;
export type SharedItem = typeof sharedItems.$inferSelect;
export type WatchSession = typeof watchSessions.$inferSelect;
export type SessionParticipant = typeof sessionParticipants.$inferSelect;
export type SessionMessage = typeof sessionMessages.$inferSelect;
export const collectionActivity = sqliteTable('collection_activity', {
	id: text('id').primaryKey(),
	collectionId: text('collection_id').notNull(),
	userId: text('user_id').notNull(),
	action: text('action').notNull(), // 'add_item' | 'remove_item' | 'join' | 'leave' | 'update'
	targetTitle: text('target_title'),
	targetMediaId: text('target_media_id'),
	createdAt: integer('created_at').notNull()
});

export type Collection = typeof collections.$inferSelect;
export type CollectionItem = typeof collectionItems.$inferSelect;
export type CollectionMember = typeof collectionMembers.$inferSelect;
export type CollectionActivity = typeof collectionActivity.$inferSelect;

// ── User Watchlist ───────────────────────────────────────────────────

export const userWatchlist = sqliteTable('user_watchlist', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id),
	mediaId: text('media_id').notNull(),
	serviceId: text('service_id').notNull(),
	mediaType: text('media_type').notNull(),
	mediaTitle: text('media_title').notNull(),
	mediaPoster: text('media_poster'),
	position: integer('position').notNull().default(0),
	createdAt: integer('created_at').notNull()
});

export type UserWatchlistItem = typeof userWatchlist.$inferSelect;

// ── User Ratings ────────────────────────────────────────────────────

export const userRatings = sqliteTable('user_ratings', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id),
	mediaId: text('media_id').notNull(),
	serviceId: text('service_id').notNull(),
	mediaType: text('media_type').notNull(),
	rating: integer('rating').notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
}, (table) => [
	// getMediaRatingStats aggregates by (media_id, service_id) — was SCAN.
	index('idx_user_ratings_media').on(table.mediaId, table.serviceId),
]);

export type UserRating = typeof userRatings.$inferSelect;

// ── Music ────────────────────────────────────────────────────────────

export const musicLikedTracks = sqliteTable('music_liked_tracks', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	trackId: text('track_id').notNull(),
	serviceId: text('service_id').notNull(),
	createdAt: integer('created_at').notNull()
});

export const musicPlaylists = sqliteTable('music_playlists', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	name: text('name').notNull(),
	description: text('description'),
	isCollaborative: integer('is_collaborative').notNull().default(0),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

export const musicPlaylistTracks = sqliteTable('music_playlist_tracks', {
	id: text('id').primaryKey(),
	playlistId: text('playlist_id').notNull(),
	trackId: text('track_id').notNull(),
	serviceId: text('service_id').notNull(),
	position: integer('position').notNull().default(0),
	addedAt: integer('added_at').notNull()
});

export const playlistCollaborators = sqliteTable('playlist_collaborators', {
	id: text('id').primaryKey(),
	playlistId: text('playlist_id').notNull(),
	userId: text('user_id').notNull(),
	role: text('role').notNull().default('editor'), // 'editor' | 'viewer'
	addedAt: integer('added_at').notNull()
});

export type MusicLikedTrack = typeof musicLikedTracks.$inferSelect;
export type MusicPlaylist = typeof musicPlaylists.$inferSelect;
export type MusicPlaylistTrack = typeof musicPlaylistTracks.$inferSelect;
export type PlaylistCollaborator = typeof playlistCollaborators.$inferSelect;

// ── Notifications ────────────────────────────────────────────────────
export const notifications = sqliteTable('notifications', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id),
	type: text('type').notNull(), // 'friend_request' | 'friend_accept' | 'share_received' | 'session_invite' | 'request_approved' | 'request_available' | 'collection_invite' | 'system'
	title: text('title').notNull(),
	message: text('message'),
	icon: text('icon'), // lucide icon name hint
	href: text('href'), // link to navigate to on click
	actorId: text('actor_id'), // user who triggered this notification
	metadata: text('metadata'), // JSON blob for extra data
	read: integer('read', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at').notNull() // unix ms
});

export type NotificationRow = typeof notifications.$inferSelect;

// ── App Settings ─────────────────────────────────────────────────────

export const appSettings = sqliteTable('app_settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

export type AppSetting = typeof appSettings.$inferSelect;

// ── Notification Preferences ─────────────────────────────────────
export const notificationPreferences = sqliteTable('notification_preferences', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	notificationType: text('notification_type').notNull(), // matches notification.type values
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	updatedAt: integer('updated_at').notNull()
});

export type NotificationPreference = typeof notificationPreferences.$inferSelect;

// ── Video Subscription Notifications ────────────────────────────
export const videoSubNotifications = sqliteTable('video_sub_notifications', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	channelId: text('channel_id').notNull(), // Invidious authorId
	channelName: text('channel_name').notNull(),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	lastCheckedVideoId: text('last_checked_video_id'), // most recent video ID we've seen
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

export type VideoSubNotification = typeof videoSubNotifications.$inferSelect;

// ── Recommendation Engine ────────────────────────────────────────────

export const userGenreAffinity = sqliteTable('user_genre_affinity', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	mediaType: text('media_type').notNull(),
	genre: text('genre').notNull(),
	score: real('score').notNull().default(0),
	playTimeMs: integer('play_time_ms'),
	completions: integer('completions'),
	interactions: integer('interactions'),
	updatedAt: integer('updated_at').notNull()
});

export const userRecProfiles = sqliteTable('user_rec_profiles', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	name: text('name').notNull(),
	isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
	config: text('config').notNull(), // JSON: RecProfileConfig
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

export const userHiddenItems = sqliteTable('user_hidden_items', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	mediaId: text('media_id').notNull(),
	serviceId: text('service_id'),
	reason: text('reason'),
	createdAt: integer('created_at').notNull()
});

export const recommendationCache = sqliteTable('recommendation_cache', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	profileId: text('profile_id').notNull(),
	provider: text('provider').notNull(),
	mediaType: text('media_type').notNull(),
	results: text('results').notNull(), // JSON
	computedAt: integer('computed_at').notNull()
}, (table) => [
	// Matches the ON CONFLICT target in recommendations/aggregator.ts.
	// Without this, upserts throw 'ON CONFLICT clause does not match any
	// PRIMARY KEY or UNIQUE constraint' at runtime.
	uniqueIndex('idx_rec_cache_unique').on(table.userId, table.profileId, table.provider, table.mediaType),
]);

// ── Books ────────────────────────────────────────────────────────────

export const bookNotes = sqliteTable('book_notes', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	bookId: text('book_id').notNull(),
	serviceId: text('service_id').notNull(),
	content: text('content').notNull(),
	cfi: text('cfi'),
	chapter: text('chapter'),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

export const bookHighlights = sqliteTable('book_highlights', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	bookId: text('book_id').notNull(),
	serviceId: text('service_id').notNull(),
	cfi: text('cfi').notNull(),
	text: text('text').notNull(),
	note: text('note'),
	color: text('color').default('yellow'),
	chapter: text('chapter'),
	createdAt: integer('created_at').notNull()
});

export const bookReadingSessions = sqliteTable('book_reading_sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	bookId: text('book_id').notNull(),
	serviceId: text('service_id').notNull(),
	startedAt: integer('started_at').notNull(),
	endedAt: integer('ended_at'),
	startCfi: text('start_cfi'),
	endCfi: text('end_cfi'),
	pagesRead: integer('pages_read'),
	durationSeconds: integer('duration_seconds')
});

export const bookBookmarks = sqliteTable('book_bookmarks', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	bookId: text('book_id').notNull(),
	serviceId: text('service_id').notNull(),
	cfi: text('cfi').notNull(),
	label: text('label'),
	createdAt: integer('created_at').notNull()
});

export const readingGoals = sqliteTable('reading_goals', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	targetBooks: integer('target_books'),
	targetPages: integer('target_pages'),
	period: text('period').notNull(), // 'yearly' | 'monthly'
	year: integer('year').notNull(),
	month: integer('month')
});

export type BookNote = typeof bookNotes.$inferSelect;
export type BookHighlight = typeof bookHighlights.$inferSelect;
export type BookReadingSession = typeof bookReadingSessions.$inferSelect;
export type BookBookmark = typeof bookBookmarks.$inferSelect;
export type ReadingGoal = typeof readingGoals.$inferSelect;

export type UserGenreAffinity = typeof userGenreAffinity.$inferSelect;
export type UserRecProfile = typeof userRecProfiles.$inferSelect;
export type UserHiddenItem = typeof userHiddenItems.$inferSelect;
export type RecommendationCacheEntry = typeof recommendationCache.$inferSelect;

// ── Game Notes ──────────────────────────────────────────────────────

export const gameNotes = sqliteTable('game_notes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	romId: text('rom_id').notNull(),
	serviceId: text('service_id').notNull(),
	content: text('content').notNull().default(''),
	updatedAt: integer('updated_at').notNull()
});

export type GameNote = typeof gameNotes.$inferSelect;

// Local metadata for cloud saves/states (labels, pins — not in RomM)
export const saveMetadata = sqliteTable('save_metadata', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	serviceId: text('service_id').notNull(),
	entryId: integer('entry_id').notNull(), // RomM save/state ID
	entryType: text('entry_type').notNull(), // 'save' | 'state'
	label: text('label'),
	pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
	updatedAt: integer('updated_at').notNull()
});

export type SaveMetadata = typeof saveMetadata.$inferSelect;

// ── Playback Speed Rules ─────────────────────────────────────────
export const playbackSpeedRules = sqliteTable('playback_speed_rules', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	/** Match scope: 'default' | 'type' | 'channel' | 'video' */
	scope: text('scope').notNull().default('default'),
	/** Match value: e.g. 'movie', 'show', channelId, or videoId/mediaId */
	scopeValue: text('scope_value'),
	scopeName: text('scope_name'),       // human-readable label (channel name, etc.)
	speed: real('speed').notNull().default(1),
	updatedAt: integer('updated_at').notNull()
});

export type PlaybackSpeedRule = typeof playbackSpeedRules.$inferSelect;

// ── SponsorBlock Preferences ─────────────────────────────────────
export const sponsorblockPreferences = sqliteTable('sponsorblock_preferences', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull().unique(),
	/** Master toggle */
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	/**
	 * JSON object mapping category → action.
	 * Categories: sponsor, selfpromo, interaction, intro, outro, preview, music_offtopic, filler, poi_highlight, chapter
	 * Actions: 'skip' | 'mute' | 'ask' | 'show' | 'off'
	 */
	categorySettings: text('category_settings').notNull().default(JSON.stringify({
		sponsor: 'skip',
		selfpromo: 'skip',
		interaction: 'skip',
		intro: 'off',
		outro: 'off',
		preview: 'off',
		music_offtopic: 'off',
		filler: 'off',
		poi_highlight: 'show',
		chapter: 'off'
	})),
	/** Show coloured segments on the player timeline */
	showOnTimeline: integer('show_on_timeline', { mode: 'boolean' }).notNull().default(true),
	/** Show a toast/snackbar when a segment is skipped */
	showSkipNotice: integer('show_skip_notice', { mode: 'boolean' }).notNull().default(true),
	/** Skip notice duration in ms (0 = permanent until dismissed) */
	skipNoticeDuration: integer('skip_notice_duration').notNull().default(3000),
	updatedAt: integer('updated_at').notNull()
});

export type SponsorBlockPreference = typeof sponsorblockPreferences.$inferSelect;

// NOTE: `recommendation_preferences` and `recommendation_feedback` were
// dropped 2026-04-17 as part of the data-model unification. Tuning now lives
// in `user_rec_profiles.config` (a zod-validated RecProfileConfig blob) and
// negative feedback lives in `user_hidden_items`. See migrations 0009-0010.
