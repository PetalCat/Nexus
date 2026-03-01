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

// User activity / watch progress
export const activity = sqliteTable('activity', {
	id: integer('id').primaryKey({ autoIncrement: true }),
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

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type MediaItem = typeof mediaItems.$inferSelect;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type Activity = typeof activity.$inferSelect;
export type Request = typeof requests.$inferSelect;
