import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Service configurations stored locally
export const services = sqliteTable('services', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	type: text('type').notNull(), // 'jellyfin' | 'kavita' | 'romm' | 'overseerr' | 'radarr' | 'sonarr' | 'lidarr' | 'prowlarr' | 'streamystats'
	url: text('url').notNull(),
	apiKey: text('api_key'),
	username: text('username'),
	password: text('password'),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`(datetime('now'))`)
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
});

// Per-user credentials for user-level services (Jellyfin, Overseerr, Kavita, etc.)
export const userServiceCredentials = sqliteTable('user_service_credentials', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	serviceId: text('service_id').notNull(), // FK → services.id
	accessToken: text('access_token'), // e.g. Jellyfin user auth token
	externalUserId: text('external_user_id'), // e.g. Jellyfin userId
	externalUsername: text('external_username'),
	linkedAt: text('linked_at')
		.notNull()
		.default(sql`(datetime('now'))`)
});

// Invite links for user registration
export const inviteLinks = sqliteTable('invite_links', {
	code: text('code').primaryKey(), // unique invite code
	createdBy: text('created_by').notNull(), // admin userId
	maxUses: integer('max_uses').notNull().default(1),
	uses: integer('uses').notNull().default(0),
	expiresAt: text('expires_at'), // null = never expires
	createdAt: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`)
});

// User activity / watch progress
export const activity = sqliteTable('activity', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id'), // nullable for legacy; new rows should always set this
	mediaId: text('media_id').notNull(),
	serviceId: text('service_id').notNull(),
	type: text('type').notNull(), // 'watch' | 'read' | 'play' | 'listen'
	progress: real('progress').notNull().default(0), // 0-1 float
	positionTicks: integer('position_ticks'), // for Jellyfin compat
	completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
	lastActivity: text('last_activity')
		.notNull()
		.default(sql`(datetime('now'))`)
});

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
	createdAt: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`)
});

// Auth sessions
export const sessions = sqliteTable('sessions', {
	token: text('token').primaryKey(),
	userId: text('user_id').notNull(),
	expiresAt: text('expires_at').notNull(),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`)
});

// Append-only media consumption event log
export const mediaEvents = sqliteTable('media_events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	serviceId: text('service_id').notNull(),
	serviceType: text('service_type').notNull(),
	eventType: text('event_type').notNull(), // play_start, play_stop, play_pause, play_resume, progress, complete, rate, like, unlike, favorite, unfavorite, add_to_watchlist, remove_from_watchlist, add_to_collection, remove_from_collection, share, mark_watched, mark_unwatched, request
	mediaId: text('media_id').notNull(),
	mediaType: text('media_type').notNull(), // movie, show, episode, book, game, music, live, album
	mediaTitle: text('media_title'),
	mediaYear: integer('media_year'),
	mediaGenres: text('media_genres'), // JSON array
	parentId: text('parent_id'), // series ID, author, platform
	parentTitle: text('parent_title'), // series name, author name
	positionTicks: integer('position_ticks'),
	durationTicks: integer('duration_ticks'),
	playDurationMs: integer('play_duration_ms'), // wall clock time spent
	deviceName: text('device_name'),
	clientName: text('client_name'),
	metadata: text('metadata'), // JSON: resolution, codecs, HDR, subtitles, CC, bitrate, transcoding, audio channels, etc.
	timestamp: integer('timestamp').notNull(), // unix ms
	ingestedAt: integer('ingested_at').notNull() // unix ms
});

// Append-only UI/behavioral event log
export const interactionEvents = sqliteTable('interaction_events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id'),
	sessionToken: text('session_token'),
	eventType: text('event_type').notNull(), // page_view, click, search, scroll_depth, card_hover, card_click, row_scroll, filter_change, sort_change, detail_view, request_submit, setting_change, login, logout, like_button, rate_button, favorite_button
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

// Pre-computed stats rollups
export const userStatsCache = sqliteTable('user_stats_cache', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	period: text('period').notNull(), // "day:2026-03-04", "week:2026-W10", "month:2026-03", "year:2026", "alltime"
	mediaType: text('media_type').notNull(), // movie, show, episode, book, game, music, all
	stats: text('stats').notNull(), // JSON blob
	computedAt: integer('computed_at').notNull() // unix ms
});

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type MediaItem = typeof mediaItems.$inferSelect;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type Activity = typeof activity.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type UserServiceCredential = typeof userServiceCredentials.$inferSelect;
export type InviteLink = typeof inviteLinks.$inferSelect;
export type MediaEvent = typeof mediaEvents.$inferSelect;
export type NewMediaEvent = typeof mediaEvents.$inferInsert;
export type InteractionEvent = typeof interactionEvents.$inferSelect;
export type NewInteractionEvent = typeof interactionEvents.$inferInsert;
export type UserStatsEntry = typeof userStatsCache.$inferSelect;

// ── Social Features ─────────────────────────────────────────────────────

export const friendships = sqliteTable('friendships', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	friendId: text('friend_id').notNull(),
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
});

export const sessionParticipants = sqliteTable('session_participants', {
	sessionId: text('session_id').notNull(),
	userId: text('user_id').notNull(),
	joinedAt: integer('joined_at').notNull(),
	leftAt: integer('left_at'),
	role: text('role').notNull().default('participant'), // 'host' | 'participant'
	voiceActive: integer('voice_active', { mode: 'boolean' }).notNull().default(false)
});

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
});

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
	userId: text('user_id').notNull(),
	role: text('role').notNull().default('viewer'), // 'owner' | 'editor' | 'viewer'
	addedAt: integer('added_at').notNull()
});

export type Friendship = typeof friendships.$inferSelect;
export type UserPresence = typeof userPresence.$inferSelect;
export type SharedItem = typeof sharedItems.$inferSelect;
export type WatchSession = typeof watchSessions.$inferSelect;
export type SessionParticipant = typeof sessionParticipants.$inferSelect;
export type SessionMessage = typeof sessionMessages.$inferSelect;
export type Collection = typeof collections.$inferSelect;
export type CollectionItem = typeof collectionItems.$inferSelect;
export type CollectionMember = typeof collectionMembers.$inferSelect;

// ── User Favorites ───────────────────────────────────────────────────

export const userFavorites = sqliteTable('user_favorites', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	mediaId: text('media_id').notNull(),
	serviceId: text('service_id').notNull(),
	mediaType: text('media_type').notNull(),
	mediaTitle: text('media_title').notNull(),
	mediaPoster: text('media_poster'),
	position: integer('position').notNull().default(0),
	createdAt: integer('created_at').notNull()
});

export type UserFavorite = typeof userFavorites.$inferSelect;

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

export type MusicLikedTrack = typeof musicLikedTracks.$inferSelect;
export type MusicPlaylist = typeof musicPlaylists.$inferSelect;
export type MusicPlaylistTrack = typeof musicPlaylistTracks.$inferSelect;

// ── App Settings ─────────────────────────────────────────────────────

export const appSettings = sqliteTable('app_settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

export type AppSetting = typeof appSettings.$inferSelect;
