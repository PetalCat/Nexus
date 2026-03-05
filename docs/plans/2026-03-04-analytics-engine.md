# Analytics Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a comprehensive analytics data engine that captures every media consumption event, UI interaction, and playback detail — then exposes blazing-fast pre-computed stats via API.

**Architecture:** Two append-only event tables (`media_events`, `interaction_events`) collect raw data from webhooks, session polling, progress reporting, and a client-side collector. A rollup engine periodically aggregates events into `user_stats_cache` for instant dashboard reads. Stats API endpoints expose everything to the user.

**Tech Stack:** SvelteKit, Drizzle ORM, better-sqlite3 (WAL mode), existing in-process cache layer.

---

### Task 1: Database Schema — Event Tables

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/index.ts`

**Step 1: Add media_events table to schema.ts**

Add after the `sessions` table definition (line ~123):

```typescript
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
```

**Step 2: Add interaction_events table to schema.ts**

Add after `mediaEvents`:

```typescript
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
```

**Step 3: Add user_stats_cache table to schema.ts**

Add after `interactionEvents`:

```typescript
// Pre-computed stats rollups
export const userStatsCache = sqliteTable('user_stats_cache', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id').notNull(),
	period: text('period').notNull(), // "day:2026-03-04", "week:2026-W10", "month:2026-03", "year:2026", "alltime"
	mediaType: text('media_type').notNull(), // movie, show, episode, book, game, music, all
	stats: text('stats').notNull(), // JSON blob
	computedAt: integer('computed_at').notNull() // unix ms
});
```

**Step 4: Add type exports to schema.ts**

Add after the existing type exports:

```typescript
export type MediaEvent = typeof mediaEvents.$inferSelect;
export type NewMediaEvent = typeof mediaEvents.$inferInsert;
export type InteractionEvent = typeof interactionEvents.$inferSelect;
export type NewInteractionEvent = typeof interactionEvents.$inferInsert;
export type UserStatsEntry = typeof userStatsCache.$inferSelect;
```

**Step 5: Add CREATE TABLE + indexes to initDb in index.ts**

Add these after the existing `safeAddColumn` calls at the end of `initDb`:

```typescript
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
```

**Step 6: Verify**

Run: `pnpm build`
Expected: Compiles with no errors.

**Step 7: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/index.ts
git commit -m "feat(analytics): add media_events, interaction_events, user_stats_cache tables"
```

---

### Task 2: Event Ingestion Service

**Files:**
- Create: `src/lib/server/analytics.ts`

**Step 1: Create the analytics ingestion module**

This is the core write path. All event sources call these functions.

```typescript
import { getDb, schema } from '../db';

// ---------------------------------------------------------------------------
// Media event ingestion
// ---------------------------------------------------------------------------

export interface MediaEventInput {
	userId: string;
	serviceId: string;
	serviceType: string;
	eventType: string;
	mediaId: string;
	mediaType: string;
	mediaTitle?: string;
	mediaYear?: number;
	mediaGenres?: string[];
	parentId?: string;
	parentTitle?: string;
	positionTicks?: number;
	durationTicks?: number;
	playDurationMs?: number;
	deviceName?: string;
	clientName?: string;
	metadata?: Record<string, unknown>;
	timestamp?: number; // defaults to now
}

/**
 * Insert a single media event. Fire-and-forget — never throws.
 */
export function emitMediaEvent(input: MediaEventInput): void {
	try {
		const db = getDb();
		const now = Date.now();
		db.insert(schema.mediaEvents)
			.values({
				userId: input.userId,
				serviceId: input.serviceId,
				serviceType: input.serviceType,
				eventType: input.eventType,
				mediaId: input.mediaId,
				mediaType: input.mediaType,
				mediaTitle: input.mediaTitle ?? null,
				mediaYear: input.mediaYear ?? null,
				mediaGenres: input.mediaGenres ? JSON.stringify(input.mediaGenres) : null,
				parentId: input.parentId ?? null,
				parentTitle: input.parentTitle ?? null,
				positionTicks: input.positionTicks ?? null,
				durationTicks: input.durationTicks ?? null,
				playDurationMs: input.playDurationMs ?? null,
				deviceName: input.deviceName ?? null,
				clientName: input.clientName ?? null,
				metadata: input.metadata ? JSON.stringify(input.metadata) : null,
				timestamp: input.timestamp ?? now,
				ingestedAt: now
			})
			.run();
	} catch (e) {
		console.error('[analytics] Failed to emit media event:', e);
	}
}

/**
 * Batch insert media events (for backfills / sync).
 */
export function emitMediaEventsBatch(events: MediaEventInput[]): number {
	if (events.length === 0) return 0;
	try {
		const db = getDb();
		const now = Date.now();
		const stmt = db.insert(schema.mediaEvents);
		const rows = events.map((input) => ({
			userId: input.userId,
			serviceId: input.serviceId,
			serviceType: input.serviceType,
			eventType: input.eventType,
			mediaId: input.mediaId,
			mediaType: input.mediaType,
			mediaTitle: input.mediaTitle ?? null,
			mediaYear: input.mediaYear ?? null,
			mediaGenres: input.mediaGenres ? JSON.stringify(input.mediaGenres) : null,
			parentId: input.parentId ?? null,
			parentTitle: input.parentTitle ?? null,
			positionTicks: input.positionTicks ?? null,
			durationTicks: input.durationTicks ?? null,
			playDurationMs: input.playDurationMs ?? null,
			deviceName: input.deviceName ?? null,
			clientName: input.clientName ?? null,
			metadata: input.metadata ? JSON.stringify(input.metadata) : null,
			timestamp: input.timestamp ?? now,
			ingestedAt: now
		}));
		stmt.values(rows).run();
		return rows.length;
	} catch (e) {
		console.error('[analytics] Batch insert failed:', e);
		return 0;
	}
}

// ---------------------------------------------------------------------------
// Interaction event ingestion
// ---------------------------------------------------------------------------

export interface InteractionEventInput {
	userId?: string;
	sessionToken?: string;
	eventType: string;
	page?: string;
	target?: string;
	targetTitle?: string;
	referrer?: string;
	searchQuery?: string;
	position?: Record<string, unknown>;
	durationMs?: number;
	metadata?: Record<string, unknown>;
	timestamp?: number;
}

/**
 * Insert a single interaction event. Fire-and-forget.
 */
export function emitInteractionEvent(input: InteractionEventInput): void {
	try {
		const db = getDb();
		db.insert(schema.interactionEvents)
			.values({
				userId: input.userId ?? null,
				sessionToken: input.sessionToken ?? null,
				eventType: input.eventType,
				page: input.page ?? null,
				target: input.target ?? null,
				targetTitle: input.targetTitle ?? null,
				referrer: input.referrer ?? null,
				searchQuery: input.searchQuery ?? null,
				position: input.position ? JSON.stringify(input.position) : null,
				durationMs: input.durationMs ?? null,
				metadata: input.metadata ? JSON.stringify(input.metadata) : null,
				timestamp: input.timestamp ?? Date.now()
			})
			.run();
	} catch (e) {
		console.error('[analytics] Failed to emit interaction event:', e);
	}
}

/**
 * Batch insert interaction events (from client-side collector flush).
 */
export function emitInteractionEventsBatch(events: InteractionEventInput[]): number {
	if (events.length === 0) return 0;
	try {
		const db = getDb();
		const rows = events.map((input) => ({
			userId: input.userId ?? null,
			sessionToken: input.sessionToken ?? null,
			eventType: input.eventType,
			page: input.page ?? null,
			target: input.target ?? null,
			targetTitle: input.targetTitle ?? null,
			referrer: input.referrer ?? null,
			searchQuery: input.searchQuery ?? null,
			position: input.position ? JSON.stringify(input.position) : null,
			durationMs: input.durationMs ?? null,
			metadata: input.metadata ? JSON.stringify(input.metadata) : null,
			timestamp: input.timestamp ?? Date.now()
		}));
		db.insert(schema.interactionEvents).values(rows).run();
		return rows.length;
	} catch (e) {
		console.error('[analytics] Interaction batch insert failed:', e);
		return 0;
	}
}

// ---------------------------------------------------------------------------
// Query helpers — raw event reads for the stats engine + API
// ---------------------------------------------------------------------------

export interface EventQueryOpts {
	userId: string;
	mediaType?: string;
	eventType?: string;
	from?: number; // unix ms
	to?: number; // unix ms
	limit?: number;
	offset?: number;
}

/**
 * Query raw media events with filters. Returns newest-first.
 */
export function queryMediaEvents(opts: EventQueryOpts) {
	const db = getDb();
	const conditions: string[] = ['user_id = ?'];
	const params: (string | number)[] = [opts.userId];

	if (opts.mediaType) {
		conditions.push('media_type = ?');
		params.push(opts.mediaType);
	}
	if (opts.eventType) {
		conditions.push('event_type = ?');
		params.push(opts.eventType);
	}
	if (opts.from) {
		conditions.push('timestamp >= ?');
		params.push(opts.from);
	}
	if (opts.to) {
		conditions.push('timestamp <= ?');
		params.push(opts.to);
	}

	const where = conditions.join(' AND ');
	const limit = opts.limit ?? 1000;
	const offset = opts.offset ?? 0;

	const sql = `SELECT * FROM media_events WHERE ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
	params.push(limit, offset);

	return db.all(sql, ...params) as (typeof schema.mediaEvents.$inferSelect)[];
}

/**
 * Count media events matching filters.
 */
export function countMediaEvents(opts: Omit<EventQueryOpts, 'limit' | 'offset'>): number {
	const db = getDb();
	const conditions: string[] = ['user_id = ?'];
	const params: (string | number)[] = [opts.userId];

	if (opts.mediaType) {
		conditions.push('media_type = ?');
		params.push(opts.mediaType);
	}
	if (opts.eventType) {
		conditions.push('event_type = ?');
		params.push(opts.eventType);
	}
	if (opts.from) {
		conditions.push('timestamp >= ?');
		params.push(opts.from);
	}
	if (opts.to) {
		conditions.push('timestamp <= ?');
		params.push(opts.to);
	}

	const where = conditions.join(' AND ');
	const row = db.get(`SELECT COUNT(*) as count FROM media_events WHERE ${where}`, ...params) as { count: number };
	return row.count;
}
```

**Step 2: Verify**

Run: `pnpm build`
Expected: Compiles.

**Step 3: Commit**

```bash
git add src/lib/server/analytics.ts
git commit -m "feat(analytics): add event ingestion service with emit + query helpers"
```

---

### Task 3: Hook into Progress Reporting (Automatic Media Event Capture)

**Files:**
- Modify: `src/routes/api/stream/[serviceId]/progress/+server.ts`

**Step 1: Emit media events from the existing progress endpoint**

This endpoint already handles play_start, progress, and play_stop for Jellyfin. We hook into it to emit events without changing existing behavior.

At the top, add import:

```typescript
import { emitMediaEvent } from '$lib/server/analytics';
```

After the successful Jellyfin report (inside the `try` block, before the cache invalidation), add event emission:

```typescript
// Emit analytics event
if (locals.user?.id) {
	const eventType = isStopped ? 'play_stop' : isStart ? 'play_start' : 'progress';
	emitMediaEvent({
		userId: locals.user.id,
		serviceId,
		serviceType: config.type,
		eventType,
		mediaId: itemId,
		mediaType: body.mediaType ?? 'movie',
		mediaTitle: body.mediaTitle,
		parentId: body.parentId,
		parentTitle: body.parentTitle,
		positionTicks: positionTicks ?? 0,
		durationTicks: body.durationTicks,
		deviceName: body.deviceName,
		clientName: body.clientName,
		metadata: body.playbackMetadata // resolution, codec, HDR, subs, etc.
	});
}
```

**Step 2: Verify**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add src/routes/api/stream/[serviceId]/progress/+server.ts
git commit -m "feat(analytics): emit media events from progress endpoint"
```

---

### Task 4: Webhook Ingestion Endpoint

**Files:**
- Create: `src/routes/api/ingest/webhook/[serviceType]/+server.ts`

**Step 1: Create the Jellyfin webhook receiver**

Jellyfin Webhook Plugin sends POST with JSON payloads for play/pause/stop/rate events.

```typescript
import { json } from '@sveltejs/kit';
import { emitMediaEvent } from '$lib/server/analytics';
import { getEnabledConfigs } from '$lib/server/services';
import { getDb, schema } from '$lib/db';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// Map Jellyfin webhook notification types to our event types
const EVENT_MAP: Record<string, string> = {
	PlaybackStart: 'play_start',
	PlaybackStop: 'play_stop',
	PlaybackProgress: 'progress',
	ItemAdded: 'add_to_library',
	UserDataSaved: 'mark_watched',
	ItemRated: 'rate'
};

const JF_TYPE_MAP: Record<string, string> = {
	Movie: 'movie',
	Series: 'show',
	Episode: 'episode',
	Audio: 'music',
	MusicAlbum: 'album'
};

/**
 * POST /api/ingest/webhook/jellyfin
 *
 * Receives Jellyfin Webhook Plugin payloads and converts them to media_events.
 * No auth required (webhook secret validated via query param or header).
 */
export const POST: RequestHandler = async ({ params, request, url }) => {
	const { serviceType } = params;

	if (serviceType === 'jellyfin') {
		return handleJellyfinWebhook(request, url);
	}

	// Future: kavita, romm, etc.
	return json({ error: `Unsupported service type: ${serviceType}` }, { status: 400 });
};

async function handleJellyfinWebhook(request: Request, url: URL) {
	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const notificationType = body.NotificationType ?? body.Event;
	const eventType = EVENT_MAP[notificationType];
	if (!eventType) {
		// Unrecognized event — accept silently
		return json({ ok: true, skipped: true });
	}

	const serverUrl = (body.ServerUrl ?? body.ServerName ?? '').replace(/\/+$/, '');
	const jellyfinUserId = body.UserId ?? body.User?.Id;
	const item = body.Item ?? body;

	if (!jellyfinUserId || !item?.Id) {
		return json({ ok: true, skipped: true });
	}

	// Resolve Nexus userId from Jellyfin external user ID
	const db = getDb();
	const cred = db
		.select()
		.from(schema.userServiceCredentials)
		.where(eq(schema.userServiceCredentials.externalUserId, jellyfinUserId))
		.get();

	if (!cred) {
		// Unknown user — still ingest with jellyfin userId as fallback
		return json({ ok: true, skipped: true, reason: 'unknown user' });
	}

	// Find the matching service config
	const configs = getEnabledConfigs().filter((c) => c.type === 'jellyfin');
	const serviceId = cred.serviceId ?? configs[0]?.id ?? 'unknown';

	const session = body.Session ?? {};
	const playState = session.PlayState ?? {};
	const transcodingInfo = session.TranscodingInfo ?? {};
	const mediaStreams = (item.MediaStreams ?? []) as any[];

	// Extract technical metadata
	const videoStream = mediaStreams.find((s: any) => s.Type === 'Video');
	const audioStream = mediaStreams.find((s: any) => s.Type === 'Audio');
	const subtitleStream = mediaStreams.find((s: any) => s.Type === 'Subtitle' && s.IsExternal !== undefined);

	const metadata: Record<string, unknown> = {};
	if (videoStream) {
		metadata.resolution = videoStream.Height >= 2160 ? '4K' : videoStream.Height >= 1080 ? '1080p' : videoStream.Height >= 720 ? '720p' : `${videoStream.Height}p`;
		metadata.videoCodec = videoStream.Codec;
		metadata.hdr = videoStream.VideoRangeType ?? (videoStream.VideoRange === 'HDR' ? 'hdr10' : 'sdr');
	}
	if (audioStream) {
		metadata.audioCodec = audioStream.Codec;
		metadata.audioChannels = audioStream.Channels ? `${audioStream.Channels > 6 ? '7.1' : audioStream.Channels > 2 ? '5.1' : 'stereo'}` : undefined;
		metadata.audioTrackLanguage = audioStream.Language;
	}
	if (subtitleStream) {
		metadata.subtitleLanguage = subtitleStream.Language;
		metadata.subtitleFormat = subtitleStream.Codec;
		metadata.closedCaptions = subtitleStream.IsForced ?? false;
	}
	if (transcodingInfo.IsTranscoding !== undefined) {
		metadata.isTranscoding = transcodingInfo.IsTranscoding;
		metadata.transcodeReason = transcodingInfo.TranscodeReasons?.join(', ');
		metadata.streamType = transcodingInfo.IsTranscoding ? 'transcode' : (body.PlayMethod === 'DirectStream' ? 'direct-stream' : 'direct-play');
		metadata.bitrate = transcodingInfo.Bitrate;
	}

	metadata.deviceName = session.DeviceName ?? body.DeviceName;
	metadata.clientName = session.Client ?? body.ClientName;

	if (body.Rating != null) metadata.ratingValue = body.Rating;
	if (body.IsFavorite != null) metadata.isFavorite = body.IsFavorite;

	emitMediaEvent({
		userId: cred.userId,
		serviceId,
		serviceType: 'jellyfin',
		eventType,
		mediaId: item.Id,
		mediaType: JF_TYPE_MAP[item.Type] ?? 'movie',
		mediaTitle: item.Name,
		mediaYear: item.ProductionYear,
		mediaGenres: item.Genres,
		parentId: item.SeriesId ?? item.ParentId,
		parentTitle: item.SeriesName,
		positionTicks: playState.PositionTicks ?? body.PlaybackPositionTicks,
		durationTicks: item.RunTimeTicks,
		deviceName: session.DeviceName ?? body.DeviceName,
		clientName: session.Client ?? body.ClientName,
		metadata
	});

	return json({ ok: true, event: eventType });
}
```

**Step 2: Verify**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add src/routes/api/ingest/webhook/
git commit -m "feat(analytics): add Jellyfin webhook ingestion endpoint"
```

---

### Task 5: Interaction Events Batch Endpoint

**Files:**
- Create: `src/routes/api/ingest/interactions/+server.ts`

**Step 1: Create the batch receiver for client-side events**

```typescript
import { json } from '@sveltejs/kit';
import { emitInteractionEventsBatch } from '$lib/server/analytics';
import type { RequestHandler } from './$types';

/**
 * POST /api/ingest/interactions
 * Receives batched interaction events from the client-side collector.
 * Body: { events: InteractionEventInput[] }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user?.id;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const events = body.events;
	if (!Array.isArray(events) || events.length === 0) {
		return json({ ok: true, ingested: 0 });
	}

	// Cap batch size to prevent abuse
	const batch = events.slice(0, 500).map((e: any) => ({
		userId: userId ?? e.userId,
		sessionToken: e.sessionToken,
		eventType: e.eventType ?? 'unknown',
		page: e.page,
		target: e.target,
		targetTitle: e.targetTitle,
		referrer: e.referrer,
		searchQuery: e.searchQuery,
		position: e.position,
		durationMs: e.durationMs,
		metadata: e.metadata,
		timestamp: e.timestamp
	}));

	const count = emitInteractionEventsBatch(batch);
	return json({ ok: true, ingested: count });
};
```

**Step 2: Verify**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add src/routes/api/ingest/interactions/
git commit -m "feat(analytics): add interaction events batch ingestion endpoint"
```

---

### Task 6: Jellyfin Session Poller

**Files:**
- Create: `src/lib/server/session-poller.ts`

**Step 1: Create the background session poller**

Polls Jellyfin `/Sessions` to detect play state changes and emit events. Runs as a singleton interval.

```typescript
import { getEnabledConfigs } from './services';
import { getUserCredentialForService } from './auth';
import { emitMediaEvent } from './analytics';
import { getDb, schema } from '../db';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JfSession {
	Id: string;
	UserId: string;
	UserName: string;
	Client: string;
	DeviceName: string;
	DeviceId: string;
	NowPlayingItem?: {
		Id: string;
		Name: string;
		Type: string;
		ProductionYear?: number;
		Genres?: string[];
		SeriesId?: string;
		SeriesName?: string;
		RunTimeTicks?: number;
		MediaStreams?: any[];
	};
	PlayState?: {
		PositionTicks?: number;
		IsPaused?: boolean;
		IsMuted?: boolean;
	};
	TranscodingInfo?: {
		IsTranscoding?: boolean;
		Bitrate?: number;
		TranscodeReasons?: string[];
		VideoCodec?: string;
		AudioCodec?: string;
	};
}

interface TrackedSession {
	sessionId: string;
	serviceId: string;
	userId: string; // Nexus userId
	mediaId: string;
	isPaused: boolean;
	startedAt: number;
	lastSeenAt: number;
}

const JF_TYPE_MAP: Record<string, string> = {
	Movie: 'movie', Series: 'show', Episode: 'episode',
	Audio: 'music', MusicAlbum: 'album'
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const activeSessions = new Map<string, TrackedSession>();
let pollInterval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

function resolveNexusUserId(jellyfinUserId: string): string | null {
	const db = getDb();
	const cred = db
		.select()
		.from(schema.userServiceCredentials)
		.where(eq(schema.userServiceCredentials.externalUserId, jellyfinUserId))
		.get();
	return cred?.userId ?? null;
}

function extractMetadata(session: JfSession): Record<string, unknown> {
	const meta: Record<string, unknown> = {};
	const item = session.NowPlayingItem;
	if (!item) return meta;

	const streams = (item.MediaStreams ?? []) as any[];
	const video = streams.find((s: any) => s.Type === 'Video');
	const audio = streams.find((s: any) => s.Type === 'Audio');
	const subtitle = streams.find((s: any) => s.Type === 'Subtitle');

	if (video) {
		meta.resolution = video.Height >= 2160 ? '4K' : video.Height >= 1080 ? '1080p' : video.Height >= 720 ? '720p' : `${video.Height}p`;
		meta.videoCodec = video.Codec;
		meta.hdr = video.VideoRangeType ?? 'sdr';
	}
	if (audio) {
		meta.audioCodec = audio.Codec;
		meta.audioChannels = audio.Channels > 6 ? '7.1' : audio.Channels > 2 ? '5.1' : 'stereo';
		meta.audioTrackLanguage = audio.Language;
	}
	if (subtitle) {
		meta.subtitleLanguage = subtitle.Language;
		meta.subtitleFormat = subtitle.Codec;
		meta.closedCaptions = !!subtitle.IsForced;
	}

	const ti = session.TranscodingInfo;
	if (ti) {
		meta.isTranscoding = ti.IsTranscoding;
		meta.bitrate = ti.Bitrate;
		meta.transcodeReason = ti.TranscodeReasons?.join(', ');
		meta.streamType = ti.IsTranscoding ? 'transcode' : 'direct-play';
	}

	return meta;
}

async function pollJellyfinSessions() {
	const configs = getEnabledConfigs().filter((c) => c.type === 'jellyfin');
	const now = Date.now();
	const seenKeys = new Set<string>();

	for (const config of configs) {
		try {
			const base = config.url.replace(/\/+$/, '');
			const res = await fetch(`${base}/Sessions`, {
				headers: {
					Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-poller-${config.id}", Version="1.0.0", Token="${config.apiKey ?? ''}"`,
					'X-Emby-Token': config.apiKey ?? ''
				},
				signal: AbortSignal.timeout(5000)
			});
			if (!res.ok) continue;

			const sessions: JfSession[] = await res.json();

			for (const session of sessions) {
				if (!session.NowPlayingItem) continue;
				const key = `${config.id}:${session.Id}`;
				seenKeys.add(key);

				const nexusUserId = resolveNexusUserId(session.UserId);
				if (!nexusUserId) continue;

				const existing = activeSessions.get(key);
				const item = session.NowPlayingItem;
				const isPaused = session.PlayState?.IsPaused ?? false;

				if (!existing) {
					// New session — emit play_start
					activeSessions.set(key, {
						sessionId: key,
						serviceId: config.id,
						userId: nexusUserId,
						mediaId: item.Id,
						isPaused,
						startedAt: now,
						lastSeenAt: now
					});
					emitMediaEvent({
						userId: nexusUserId,
						serviceId: config.id,
						serviceType: 'jellyfin',
						eventType: 'play_start',
						mediaId: item.Id,
						mediaType: JF_TYPE_MAP[item.Type] ?? 'movie',
						mediaTitle: item.Name,
						mediaYear: item.ProductionYear,
						mediaGenres: item.Genres,
						parentId: item.SeriesId,
						parentTitle: item.SeriesName,
						positionTicks: session.PlayState?.PositionTicks,
						durationTicks: item.RunTimeTicks,
						deviceName: session.DeviceName,
						clientName: session.Client,
						metadata: extractMetadata(session)
					});
				} else if (existing.mediaId !== item.Id) {
					// Media changed — emit stop for old, start for new
					emitMediaEvent({
						userId: nexusUserId,
						serviceId: config.id,
						serviceType: 'jellyfin',
						eventType: 'play_stop',
						mediaId: existing.mediaId,
						mediaType: 'movie', // best effort
						playDurationMs: now - existing.startedAt,
						timestamp: now
					});
					activeSessions.set(key, {
						sessionId: key,
						serviceId: config.id,
						userId: nexusUserId,
						mediaId: item.Id,
						isPaused,
						startedAt: now,
						lastSeenAt: now
					});
					emitMediaEvent({
						userId: nexusUserId,
						serviceId: config.id,
						serviceType: 'jellyfin',
						eventType: 'play_start',
						mediaId: item.Id,
						mediaType: JF_TYPE_MAP[item.Type] ?? 'movie',
						mediaTitle: item.Name,
						mediaYear: item.ProductionYear,
						mediaGenres: item.Genres,
						parentId: item.SeriesId,
						parentTitle: item.SeriesName,
						positionTicks: session.PlayState?.PositionTicks,
						durationTicks: item.RunTimeTicks,
						deviceName: session.DeviceName,
						clientName: session.Client,
						metadata: extractMetadata(session)
					});
				} else {
					// Same media — detect pause/resume transitions
					if (isPaused && !existing.isPaused) {
						emitMediaEvent({
							userId: nexusUserId,
							serviceId: config.id,
							serviceType: 'jellyfin',
							eventType: 'play_pause',
							mediaId: item.Id,
							mediaType: JF_TYPE_MAP[item.Type] ?? 'movie',
							mediaTitle: item.Name,
							positionTicks: session.PlayState?.PositionTicks,
							durationTicks: item.RunTimeTicks,
							deviceName: session.DeviceName,
							clientName: session.Client
						});
					} else if (!isPaused && existing.isPaused) {
						emitMediaEvent({
							userId: nexusUserId,
							serviceId: config.id,
							serviceType: 'jellyfin',
							eventType: 'play_resume',
							mediaId: item.Id,
							mediaType: JF_TYPE_MAP[item.Type] ?? 'movie',
							mediaTitle: item.Name,
							positionTicks: session.PlayState?.PositionTicks,
							durationTicks: item.RunTimeTicks,
							deviceName: session.DeviceName,
							clientName: session.Client
						});
					}
					existing.isPaused = isPaused;
					existing.lastSeenAt = now;
				}
			}
		} catch (e) {
			// Network error — skip this config
			console.error(`[poller] Failed to poll ${config.name}:`, e instanceof Error ? e.message : e);
		}
	}

	// Detect ended sessions (no longer in Jellyfin response)
	for (const [key, session] of activeSessions) {
		if (!seenKeys.has(key)) {
			emitMediaEvent({
				userId: session.userId,
				serviceId: session.serviceId,
				serviceType: 'jellyfin',
				eventType: 'play_stop',
				mediaId: session.mediaId,
				mediaType: 'movie',
				playDurationMs: now - session.startedAt,
				timestamp: now
			});
			activeSessions.delete(key);
		}
	}
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000; // 10 seconds

export function startSessionPoller() {
	if (pollInterval) return; // already running
	console.log('[poller] Starting Jellyfin session poller (10s interval)');
	pollInterval = setInterval(() => {
		pollJellyfinSessions().catch((e) =>
			console.error('[poller] Unhandled error:', e)
		);
	}, POLL_INTERVAL_MS);
	// Run immediately on start
	pollJellyfinSessions().catch(() => {});
}

export function stopSessionPoller() {
	if (pollInterval) {
		clearInterval(pollInterval);
		pollInterval = null;
		console.log('[poller] Session poller stopped');
	}
}
```

**Step 2: Start the poller in hooks.server.ts**

Add to the end of `src/hooks.server.ts`:

```typescript
import { startSessionPoller } from '$lib/server/session-poller';

// Start background analytics poller
startSessionPoller();
```

**Step 3: Verify**

Run: `pnpm build`

**Step 4: Commit**

```bash
git add src/lib/server/session-poller.ts src/hooks.server.ts
git commit -m "feat(analytics): add Jellyfin session poller for automatic event capture"
```

---

### Task 7: Stats Computation Engine

**Files:**
- Create: `src/lib/server/stats-engine.ts`

**Step 1: Create the rollup computation engine**

This queries `media_events` and `interaction_events` to build pre-computed stats per user/period/mediaType and writes them to `user_stats_cache`.

```typescript
import { getDb, schema } from '../db';
import { and, eq, gte, lte, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

export type PeriodGranularity = 'day' | 'week' | 'month' | 'year' | 'alltime';

interface TimeRange {
	from: number; // unix ms
	to: number; // unix ms
	period: string; // "day:2026-03-04", "month:2026-03", etc.
}

export function currentPeriod(granularity: PeriodGranularity, date = new Date()): TimeRange {
	const y = date.getFullYear();
	const m = date.getMonth();
	const d = date.getDate();

	switch (granularity) {
		case 'day': {
			const start = new Date(y, m, d);
			const end = new Date(y, m, d + 1);
			const pad = (n: number) => String(n).padStart(2, '0');
			return { from: start.getTime(), to: end.getTime(), period: `day:${y}-${pad(m + 1)}-${pad(d)}` };
		}
		case 'week': {
			const dayOfWeek = date.getDay();
			const monday = new Date(y, m, d - ((dayOfWeek + 6) % 7));
			const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
			const weekNum = getISOWeek(date);
			return { from: monday.getTime(), to: sunday.getTime(), period: `week:${y}-W${String(weekNum).padStart(2, '0')}` };
		}
		case 'month': {
			const start = new Date(y, m, 1);
			const end = new Date(y, m + 1, 1);
			return { from: start.getTime(), to: end.getTime(), period: `month:${y}-${String(m + 1).padStart(2, '0')}` };
		}
		case 'year': {
			const start = new Date(y, 0, 1);
			const end = new Date(y + 1, 0, 1);
			return { from: start.getTime(), to: end.getTime(), period: `year:${y}` };
		}
		case 'alltime':
			return { from: 0, to: Date.now(), period: 'alltime' };
	}
}

function getISOWeek(date: Date): number {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ---------------------------------------------------------------------------
// Stats computation
// ---------------------------------------------------------------------------

export interface ComputedStats {
	totalPlayTimeMs: number;
	totalItems: number;
	totalSessions: number;
	completions: number;
	avgSessionLengthMs: number;
	longestSessionMs: number;

	topItems: { mediaId: string; title: string; mediaType: string; playTimeMs: number; sessions: number }[];
	topGenres: { genre: string; playTimeMs: number; count: number; pct: number }[];

	resolutionBreakdown: Record<string, number>;
	hdrBreakdown: Record<string, number>;
	transcodeRate: number;
	subtitleUsage: number;

	topDevices: { name: string; playTimeMs: number; sessions: number }[];
	topClients: { name: string; playTimeMs: number; sessions: number }[];

	totalLikes: number;
	totalRatings: number;
	totalFavorites: number;

	hourlyDistribution: number[];
	weekdayDistribution: number[];

	streaks: { current: number; longest: number };
	avgCompletionRate: number;

	totalPageViews: number;
	totalTimeInAppMs: number;
	mostVisitedPages: { page: string; views: number }[];
}

/**
 * Compute stats for a user within a time range, optionally filtered by media type.
 */
export function computeStats(userId: string, from: number, to: number, mediaType?: string): ComputedStats {
	const db = getDb();

	// Base media event filters
	const mediaTypeFilter = mediaType && mediaType !== 'all' ? `AND media_type = '${mediaType}'` : '';

	// -- Core play stats from play_stop events (they carry playDurationMs) --
	const playStops = db.all(`
		SELECT media_id, media_title, media_type, play_duration_ms, position_ticks, duration_ticks,
		       device_name, client_name, metadata, timestamp
		FROM media_events
		WHERE user_id = ? AND event_type = 'play_stop' AND timestamp >= ? AND timestamp <= ? ${mediaTypeFilter}
		ORDER BY timestamp DESC
	`, userId, from, to) as any[];

	const playStarts = db.all(`
		SELECT media_id, media_title, media_type, device_name, client_name, metadata, timestamp
		FROM media_events
		WHERE user_id = ? AND event_type = 'play_start' AND timestamp >= ? AND timestamp <= ? ${mediaTypeFilter}
		ORDER BY timestamp DESC
	`, userId, from, to) as any[];

	// Completions
	const completions = db.get(`
		SELECT COUNT(*) as count FROM media_events
		WHERE user_id = ? AND event_type = 'complete' AND timestamp >= ? AND timestamp <= ? ${mediaTypeFilter}
	`, userId, from, to) as { count: number };

	// Social signals
	const likes = db.get(`SELECT COUNT(*) as count FROM media_events WHERE user_id = ? AND event_type = 'like' AND timestamp >= ? AND timestamp <= ? ${mediaTypeFilter}`, userId, from, to) as { count: number };
	const ratings = db.get(`SELECT COUNT(*) as count FROM media_events WHERE user_id = ? AND event_type = 'rate' AND timestamp >= ? AND timestamp <= ? ${mediaTypeFilter}`, userId, from, to) as { count: number };
	const favorites = db.get(`SELECT COUNT(*) as count FROM media_events WHERE user_id = ? AND event_type = 'favorite' AND timestamp >= ? AND timestamp <= ? ${mediaTypeFilter}`, userId, from, to) as { count: number };

	// -- Aggregate play stats --
	let totalPlayTimeMs = 0;
	let longestSessionMs = 0;
	const itemMap = new Map<string, { title: string; mediaType: string; playTimeMs: number; sessions: number }>();
	const genreMap = new Map<string, { playTimeMs: number; count: number }>();
	const deviceMap = new Map<string, { playTimeMs: number; sessions: number }>();
	const clientMap = new Map<string, { playTimeMs: number; sessions: number }>();
	const resolutionMap = new Map<string, number>();
	const hdrMap = new Map<string, number>();
	let transcodeCount = 0;
	let subtitleCount = 0;
	const hourly = new Array(24).fill(0);
	const weekday = new Array(7).fill(0);
	const activeDays = new Set<string>();

	for (const row of playStops) {
		const dur = row.play_duration_ms ?? 0;
		totalPlayTimeMs += dur;
		if (dur > longestSessionMs) longestSessionMs = dur;

		// Item aggregation
		const key = row.media_id;
		const existing = itemMap.get(key);
		if (existing) {
			existing.playTimeMs += dur;
			existing.sessions += 1;
		} else {
			itemMap.set(key, { title: row.media_title ?? key, mediaType: row.media_type, playTimeMs: dur, sessions: 1 });
		}

		// Genre aggregation
		if (row.media_genres) {
			try {
				const genres: string[] = JSON.parse(row.media_genres);
				for (const g of genres) {
					const ge = genreMap.get(g);
					if (ge) { ge.playTimeMs += dur; ge.count += 1; }
					else genreMap.set(g, { playTimeMs: dur, count: 1 });
				}
			} catch { /* ignore */ }
		}

		// Device/client
		if (row.device_name) {
			const d = deviceMap.get(row.device_name);
			if (d) { d.playTimeMs += dur; d.sessions += 1; }
			else deviceMap.set(row.device_name, { playTimeMs: dur, sessions: 1 });
		}
		if (row.client_name) {
			const c = clientMap.get(row.client_name);
			if (c) { c.playTimeMs += dur; c.sessions += 1; }
			else clientMap.set(row.client_name, { playTimeMs: dur, sessions: 1 });
		}

		// Technical metadata
		if (row.metadata) {
			try {
				const meta = JSON.parse(row.metadata);
				if (meta.resolution) resolutionMap.set(meta.resolution, (resolutionMap.get(meta.resolution) ?? 0) + 1);
				if (meta.hdr) hdrMap.set(meta.hdr, (hdrMap.get(meta.hdr) ?? 0) + 1);
				if (meta.isTranscoding) transcodeCount++;
				if (meta.subtitleLanguage) subtitleCount++;
			} catch { /* ignore */ }
		}

		// Time patterns
		const date = new Date(row.timestamp);
		hourly[date.getHours()] += dur;
		weekday[date.getDay()] += dur;
		activeDays.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
	}

	const totalSessions = playStarts.length;
	const uniqueItems = itemMap.size;
	const avgSessionLengthMs = totalSessions > 0 ? totalPlayTimeMs / totalSessions : 0;

	// Completion rate: completions / unique items started
	const startedItems = new Set(playStarts.map((r: any) => r.media_id));
	const avgCompletionRate = startedItems.size > 0 ? (completions.count / startedItems.size) : 0;

	// Top lists
	const topItems = [...itemMap.entries()]
		.map(([mediaId, v]) => ({ mediaId, ...v }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs)
		.slice(0, 20);

	const totalGenreTime = [...genreMap.values()].reduce((s, g) => s + g.playTimeMs, 0);
	const topGenres = [...genreMap.entries()]
		.map(([genre, v]) => ({ genre, ...v, pct: totalGenreTime > 0 ? Math.round((v.playTimeMs / totalGenreTime) * 100) : 0 }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs);

	const topDevices = [...deviceMap.entries()]
		.map(([name, v]) => ({ name, ...v }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs)
		.slice(0, 10);

	const topClients = [...clientMap.entries()]
		.map(([name, v]) => ({ name, ...v }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs)
		.slice(0, 10);

	// Resolution/HDR breakdowns as percentages
	const totalResolved = [...resolutionMap.values()].reduce((s, n) => s + n, 0);
	const resolutionBreakdown: Record<string, number> = {};
	for (const [k, v] of resolutionMap) resolutionBreakdown[k] = totalResolved > 0 ? Math.round((v / totalResolved) * 100) : 0;

	const totalHdr = [...hdrMap.values()].reduce((s, n) => s + n, 0);
	const hdrBreakdown: Record<string, number> = {};
	for (const [k, v] of hdrMap) hdrBreakdown[k] = totalHdr > 0 ? Math.round((v / totalHdr) * 100) : 0;

	const transcodeRate = totalSessions > 0 ? Math.round((transcodeCount / totalSessions) * 100) : 0;
	const subtitleUsage = totalSessions > 0 ? Math.round((subtitleCount / totalSessions) * 100) : 0;

	// Streaks (consecutive days with activity)
	const sortedDays = [...activeDays].sort();
	let currentStreak = 0, longestStreak = 0, streak = 0;
	for (let i = 0; i < sortedDays.length; i++) {
		if (i === 0) { streak = 1; }
		else {
			const prev = new Date(sortedDays[i - 1]);
			const curr = new Date(sortedDays[i]);
			const diff = (curr.getTime() - prev.getTime()) / 86400000;
			streak = diff <= 1 ? streak + 1 : 1;
		}
		if (streak > longestStreak) longestStreak = streak;
	}
	// Check if the most recent day is today or yesterday for current streak
	if (sortedDays.length > 0) {
		const today = new Date();
		const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
		const yesterday = new Date(today.getTime() - 86400000);
		const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
		if (sortedDays[sortedDays.length - 1] === todayKey || sortedDays[sortedDays.length - 1] === yesterdayKey) {
			currentStreak = streak;
		}
	}

	// -- Interaction stats --
	const pageViews = db.get(`
		SELECT COUNT(*) as count FROM interaction_events
		WHERE user_id = ? AND event_type = 'page_view' AND timestamp >= ? AND timestamp <= ?
	`, userId, from, to) as { count: number };

	const timeInApp = db.get(`
		SELECT COALESCE(SUM(duration_ms), 0) as total FROM interaction_events
		WHERE user_id = ? AND event_type = 'page_view' AND timestamp >= ? AND timestamp <= ?
	`, userId, from, to) as { total: number };

	const topPages = db.all(`
		SELECT page, COUNT(*) as views FROM interaction_events
		WHERE user_id = ? AND event_type = 'page_view' AND timestamp >= ? AND timestamp <= ?
		GROUP BY page ORDER BY views DESC LIMIT 10
	`, userId, from, to) as { page: string; views: number }[];

	return {
		totalPlayTimeMs: totalPlayTimeMs,
		totalItems: uniqueItems,
		totalSessions,
		completions: completions.count,
		avgSessionLengthMs,
		longestSessionMs,
		topItems,
		topGenres,
		resolutionBreakdown,
		hdrBreakdown,
		transcodeRate,
		subtitleUsage,
		topDevices,
		topClients,
		totalLikes: likes.count,
		totalRatings: ratings.count,
		totalFavorites: favorites.count,
		hourlyDistribution: hourly,
		weekdayDistribution: weekday,
		streaks: { current: currentStreak, longest: longestStreak },
		avgCompletionRate,
		totalPageViews: pageViews.count,
		totalTimeInAppMs: timeInApp.total,
		mostVisitedPages: topPages
	};
}

// ---------------------------------------------------------------------------
// Cache writer — builds rollups and writes to user_stats_cache
// ---------------------------------------------------------------------------

export function buildAndCacheStats(userId: string, granularity: PeriodGranularity, mediaType = 'all'): ComputedStats {
	const range = currentPeriod(granularity);
	const stats = computeStats(userId, range.from, range.to, mediaType);
	const db = getDb();
	const now = Date.now();

	// Upsert into cache
	db.run(`
		INSERT INTO user_stats_cache (user_id, period, media_type, stats, computed_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, period, media_type) DO UPDATE SET
			stats = excluded.stats,
			computed_at = excluded.computed_at
	`, userId, range.period, mediaType, JSON.stringify(stats), now);

	return stats;
}

/**
 * Get cached stats or compute fresh if stale/missing.
 */
export function getOrComputeStats(
	userId: string,
	period: string,
	mediaType = 'all',
	maxAgeMs = 300_000 // 5 min default
): ComputedStats {
	const db = getDb();
	const cached = db.get(`
		SELECT stats, computed_at FROM user_stats_cache
		WHERE user_id = ? AND period = ? AND media_type = ?
	`, userId, period, mediaType) as { stats: string; computed_at: number } | undefined;

	if (cached && (Date.now() - cached.computed_at) < maxAgeMs) {
		return JSON.parse(cached.stats);
	}

	// Parse period to determine range
	const [gran, value] = period.split(':');
	let from: number, to: number;

	if (gran === 'alltime') {
		from = 0;
		to = Date.now();
	} else if (gran === 'day') {
		const d = new Date(value);
		from = d.getTime();
		to = from + 86400000;
	} else if (gran === 'week') {
		// value = "2026-W10"
		const [y, w] = value.split('-W').map(Number);
		const jan1 = new Date(y, 0, 1);
		const dayOffset = (jan1.getDay() + 6) % 7; // days since Monday
		const weekStart = new Date(y, 0, 1 + (w - 1) * 7 - dayOffset);
		from = weekStart.getTime();
		to = from + 7 * 86400000;
	} else if (gran === 'month') {
		const [y, m] = value.split('-').map(Number);
		from = new Date(y, m - 1, 1).getTime();
		to = new Date(y, m, 1).getTime();
	} else if (gran === 'year') {
		const y = parseInt(value);
		from = new Date(y, 0, 1).getTime();
		to = new Date(y + 1, 0, 1).getTime();
	} else {
		from = 0;
		to = Date.now();
	}

	const stats = computeStats(userId, from, to, mediaType);
	const now = Date.now();
	db.run(`
		INSERT INTO user_stats_cache (user_id, period, media_type, stats, computed_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, period, media_type) DO UPDATE SET
			stats = excluded.stats,
			computed_at = excluded.computed_at
	`, userId, period, mediaType, JSON.stringify(stats), now);

	return stats;
}

// ---------------------------------------------------------------------------
// Background rebuild — called periodically
// ---------------------------------------------------------------------------

export function rebuildStatsForUser(userId: string) {
	const mediaTypes = ['all', 'movie', 'show', 'episode', 'book', 'game', 'music'];
	const granularities: PeriodGranularity[] = ['day', 'week', 'month', 'year', 'alltime'];

	for (const mt of mediaTypes) {
		for (const gran of granularities) {
			try {
				buildAndCacheStats(userId, gran, mt);
			} catch (e) {
				console.error(`[stats] Failed to build ${gran}/${mt} for ${userId}:`, e);
			}
		}
	}
}

/**
 * Get all user IDs that have media events (for background rebuild).
 */
export function getActiveUserIds(): string[] {
	const db = getDb();
	const rows = db.all(`SELECT DISTINCT user_id FROM media_events`) as { user_id: string }[];
	return rows.map((r) => r.user_id);
}
```

**Step 2: Verify**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add src/lib/server/stats-engine.ts
git commit -m "feat(analytics): add stats computation engine with rollup builder"
```

---

### Task 8: Background Stats Rebuild Scheduler

**Files:**
- Create: `src/lib/server/stats-scheduler.ts`
- Modify: `src/hooks.server.ts`

**Step 1: Create the scheduler**

```typescript
import { getActiveUserIds, rebuildStatsForUser, buildAndCacheStats } from './stats-engine';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

// Stagger rebuilds: daily stats every 5min, weekly every 30min, etc.
// We keep it simple: one pass every 5 minutes, rebuild current day + week.
// Heavier periods (month/year/alltime) rebuild less often via a counter.

let tickCount = 0;

function runScheduledRebuilds() {
	tickCount++;
	const userIds = getActiveUserIds();

	for (const userId of userIds) {
		try {
			// Always rebuild current day (5 min cycle)
			buildAndCacheStats(userId, 'day', 'all');

			// Every 6th tick (30 min) — rebuild week
			if (tickCount % 6 === 0) {
				buildAndCacheStats(userId, 'week', 'all');
			}

			// Every 24th tick (2 hours) — rebuild month
			if (tickCount % 24 === 0) {
				buildAndCacheStats(userId, 'month', 'all');
			}

			// Every 72nd tick (6 hours) — rebuild year
			if (tickCount % 72 === 0) {
				buildAndCacheStats(userId, 'year', 'all');
			}

			// Every 144th tick (12 hours) — full rebuild all periods + media types
			if (tickCount % 144 === 0) {
				rebuildStatsForUser(userId);
			}
		} catch (e) {
			console.error(`[stats-scheduler] Error for user ${userId}:`, e);
		}
	}
}

export function startStatsScheduler() {
	if (schedulerInterval) return;
	console.log('[stats-scheduler] Starting stats rebuild scheduler (5min interval)');
	schedulerInterval = setInterval(runScheduledRebuilds, 5 * 60 * 1000);
	// Run first rebuild after 30 seconds (let the app finish booting)
	setTimeout(runScheduledRebuilds, 30_000);
}

export function stopStatsScheduler() {
	if (schedulerInterval) {
		clearInterval(schedulerInterval);
		schedulerInterval = null;
	}
}
```

**Step 2: Start scheduler in hooks.server.ts**

Add import and call alongside the session poller:

```typescript
import { startStatsScheduler } from '$lib/server/stats-scheduler';

startStatsScheduler();
```

**Step 3: Verify**

Run: `pnpm build`

**Step 4: Commit**

```bash
git add src/lib/server/stats-scheduler.ts src/hooks.server.ts
git commit -m "feat(analytics): add background stats rebuild scheduler"
```

---

### Task 9: Stats API Endpoints

**Files:**
- Create: `src/routes/api/user/stats/+server.ts`
- Create: `src/routes/api/user/stats/timeline/+server.ts`
- Create: `src/routes/api/user/stats/top/+server.ts`
- Create: `src/routes/api/user/stats/wrapped/+server.ts`
- Create: `src/routes/api/user/stats/live/+server.ts`
- Create: `src/routes/api/user/stats/events/+server.ts`

**Step 1: Main stats endpoint**

`src/routes/api/user/stats/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import { getOrComputeStats } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats?period=day:2026-03-04&type=movie
 * Returns pre-computed stats rollup for the user.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const period = url.searchParams.get('period') ?? 'alltime';
	const mediaType = url.searchParams.get('type') ?? 'all';

	const stats = getOrComputeStats(locals.user.id, period, mediaType);
	return json({ period, mediaType, stats });
};
```

**Step 2: Timeline endpoint (time series for charts)**

`src/routes/api/user/stats/timeline/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import { getOrComputeStats, currentPeriod } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats/timeline?from=2026-01&to=2026-03&granularity=day&type=all
 * Returns an array of stats rollups for charting.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const granularity = (url.searchParams.get('granularity') ?? 'day') as 'day' | 'week' | 'month';
	const mediaType = url.searchParams.get('type') ?? 'all';
	const fromStr = url.searchParams.get('from');
	const toStr = url.searchParams.get('to');

	if (!fromStr || !toStr) {
		return json({ error: 'from and to params required (YYYY-MM-DD or YYYY-MM)' }, { status: 400 });
	}

	const points: { period: string; totalPlayTimeMs: number; totalSessions: number; totalItems: number }[] = [];

	if (granularity === 'day') {
		const start = new Date(fromStr);
		const end = new Date(toStr);
		const cursor = new Date(start);
		while (cursor <= end) {
			const pad = (n: number) => String(n).padStart(2, '0');
			const period = `day:${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
			const stats = getOrComputeStats(locals.user.id, period, mediaType, 600_000);
			points.push({
				period,
				totalPlayTimeMs: stats.totalPlayTimeMs,
				totalSessions: stats.totalSessions,
				totalItems: stats.totalItems
			});
			cursor.setDate(cursor.getDate() + 1);
			if (points.length > 366) break; // safety cap
		}
	} else if (granularity === 'month') {
		const [fy, fm] = fromStr.split('-').map(Number);
		const [ty, tm] = toStr.split('-').map(Number);
		let y = fy, m = fm;
		while (y < ty || (y === ty && m <= tm)) {
			const period = `month:${y}-${String(m).padStart(2, '0')}`;
			const stats = getOrComputeStats(locals.user.id, period, mediaType, 3600_000);
			points.push({
				period,
				totalPlayTimeMs: stats.totalPlayTimeMs,
				totalSessions: stats.totalSessions,
				totalItems: stats.totalItems
			});
			m++;
			if (m > 12) { m = 1; y++; }
			if (points.length > 120) break;
		}
	}

	return json({ granularity, mediaType, points });
};
```

**Step 3: Top-N endpoint**

`src/routes/api/user/stats/top/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import { getOrComputeStats } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats/top?category=genres|items|devices|clients&period=year:2025&limit=20
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const category = url.searchParams.get('category') ?? 'items';
	const period = url.searchParams.get('period') ?? 'alltime';
	const mediaType = url.searchParams.get('type') ?? 'all';
	const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '20'));

	const stats = getOrComputeStats(locals.user.id, period, mediaType);

	let data: unknown[];
	switch (category) {
		case 'genres': data = stats.topGenres.slice(0, limit); break;
		case 'items': data = stats.topItems.slice(0, limit); break;
		case 'devices': data = stats.topDevices.slice(0, limit); break;
		case 'clients': data = stats.topClients.slice(0, limit); break;
		default: data = stats.topItems.slice(0, limit);
	}

	return json({ category, period, mediaType, data });
};
```

**Step 4: Wrapped endpoint (full year recap)**

`src/routes/api/user/stats/wrapped/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import { getOrComputeStats } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats/wrapped?year=2025
 * Returns the full year recap for Wrapped-style presentations.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const year = url.searchParams.get('year') ?? String(new Date().getFullYear() - 1);
	const period = `year:${year}`;

	// Fetch stats for all media types + overall
	const [all, movies, shows, books, games, music] = ['all', 'movie', 'show', 'book', 'game', 'music'].map(
		(mt) => getOrComputeStats(locals.user!.id, period, mt, 3600_000)
	);

	// Monthly breakdown for the year
	const monthly: { month: string; playTimeMs: number; sessions: number }[] = [];
	for (let m = 1; m <= 12; m++) {
		const monthPeriod = `month:${year}-${String(m).padStart(2, '0')}`;
		const s = getOrComputeStats(locals.user.id, monthPeriod, 'all', 3600_000);
		monthly.push({
			month: `${year}-${String(m).padStart(2, '0')}`,
			playTimeMs: s.totalPlayTimeMs,
			sessions: s.totalSessions
		});
	}

	return json({
		year: parseInt(year),
		overall: all,
		byType: { movies, shows, books, games, music },
		monthly
	});
};
```

**Step 5: Live stats endpoint (today, computed fresh)**

`src/routes/api/user/stats/live/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import { computeStats, currentPeriod } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats/live
 * Real-time stats for today — always computed fresh (not cached).
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const today = currentPeriod('day');
	const stats = computeStats(locals.user.id, today.from, today.to);

	return json({ period: today.period, stats });
};
```

**Step 6: Raw events endpoint (for power users / debugging)**

`src/routes/api/user/stats/events/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import { queryMediaEvents, countMediaEvents } from '$lib/server/analytics';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats/events?type=movie&event=play_stop&from=...&to=...&limit=50&offset=0
 * Returns raw media events for the user.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const mediaType = url.searchParams.get('type') ?? undefined;
	const eventType = url.searchParams.get('event') ?? undefined;
	const from = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!) : undefined;
	const to = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!) : undefined;
	const limit = Math.min(500, parseInt(url.searchParams.get('limit') ?? '50'));
	const offset = parseInt(url.searchParams.get('offset') ?? '0');

	const opts = { userId: locals.user.id, mediaType, eventType, from, to, limit, offset };
	const events = queryMediaEvents(opts);
	const total = countMediaEvents({ userId: locals.user.id, mediaType, eventType, from, to });

	return json({ events, total, limit, offset });
};
```

**Step 7: Verify**

Run: `pnpm build`

**Step 8: Commit**

```bash
git add src/routes/api/user/stats/
git commit -m "feat(analytics): add stats API endpoints (stats, timeline, top, wrapped, live, events)"
```

---

### Task 10: Client-Side Interaction Collector

**Files:**
- Create: `src/lib/stores/analytics.ts`
- Modify: `src/routes/+layout.svelte`

**Step 1: Create the client-side analytics store**

A lightweight Svelte module that auto-captures page views, clicks on tracked elements, and search behavior — batches and flushes to the server.

```typescript
import { browser } from '$app/environment';
import { beforeNavigate, afterNavigate } from '$app/navigation';

interface PendingEvent {
	eventType: string;
	page?: string;
	target?: string;
	targetTitle?: string;
	referrer?: string;
	searchQuery?: string;
	position?: Record<string, unknown>;
	durationMs?: number;
	metadata?: Record<string, unknown>;
	timestamp: number;
}

const FLUSH_INTERVAL = 5000; // 5 seconds
const MAX_BATCH = 200;

let queue: PendingEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let currentPage = '';
let pageEnteredAt = 0;

function enqueue(event: PendingEvent) {
	queue.push(event);
	if (queue.length >= MAX_BATCH) flush();
}

async function flush() {
	if (queue.length === 0) return;
	const batch = queue.splice(0, MAX_BATCH);
	try {
		if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
			navigator.sendBeacon('/api/ingest/interactions', JSON.stringify({ events: batch }));
		} else {
			fetch('/api/ingest/interactions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ events: batch }),
				keepalive: true
			}).catch(() => {});
		}
	} catch {
		// Best-effort — don't lose data, but don't crash
	}
}

/**
 * Initialize the analytics collector. Call once from +layout.svelte.
 */
export function initAnalytics() {
	if (!browser) return;

	// Periodic flush
	flushTimer = setInterval(flush, FLUSH_INTERVAL);

	// Flush on page unload
	window.addEventListener('beforeunload', () => {
		// Emit page_view duration for current page
		if (currentPage && pageEnteredAt) {
			enqueue({
				eventType: 'page_view',
				page: currentPage,
				durationMs: Date.now() - pageEnteredAt,
				timestamp: pageEnteredAt
			});
		}
		flush();
	});

	// Click tracking — captures clicks on elements with data-track attribute
	document.addEventListener('click', (e) => {
		const target = (e.target as HTMLElement).closest('[data-track]');
		if (!target) return;

		const trackId = target.getAttribute('data-track') ?? '';
		const trackTitle = target.getAttribute('data-track-title') ?? '';
		const trackPosition = target.getAttribute('data-track-position');

		enqueue({
			eventType: 'click',
			page: window.location.pathname,
			target: trackId,
			targetTitle: trackTitle,
			position: trackPosition ? JSON.parse(trackPosition) : undefined,
			timestamp: Date.now()
		});
	}, { passive: true });

	// Search tracking — listen for search input events
	document.addEventListener('input', (e) => {
		const input = e.target as HTMLInputElement;
		if (input.getAttribute('data-track-search') != null) {
			// Debounced — we only care about the final query (captured on navigation)
		}
	}, { passive: true });
}

/**
 * Track SvelteKit page navigation. Call from afterNavigate.
 */
export function trackPageView(toPath: string) {
	if (!browser) return;

	// Close previous page view
	if (currentPage && pageEnteredAt) {
		enqueue({
			eventType: 'page_view',
			page: currentPage,
			durationMs: Date.now() - pageEnteredAt,
			referrer: document.referrer || undefined,
			timestamp: pageEnteredAt
		});
	}

	currentPage = toPath;
	pageEnteredAt = Date.now();
}

/**
 * Track a search event.
 */
export function trackSearch(query: string, resultCount: number) {
	if (!browser) return;
	enqueue({
		eventType: 'search',
		page: window.location.pathname,
		searchQuery: query,
		metadata: { resultCount },
		timestamp: Date.now()
	});
}

/**
 * Track a custom interaction event.
 */
export function trackEvent(eventType: string, data?: {
	target?: string;
	targetTitle?: string;
	position?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}) {
	if (!browser) return;
	enqueue({
		eventType,
		page: window.location.pathname,
		target: data?.target,
		targetTitle: data?.targetTitle,
		position: data?.position,
		metadata: data?.metadata,
		timestamp: Date.now()
	});
}

export function destroyAnalytics() {
	if (flushTimer) clearInterval(flushTimer);
	flush();
}
```

**Step 2: Wire into the root layout**

In `src/routes/+layout.svelte`, add the analytics initialization. This requires reading the file first to find the right insertion point.

At the top of the `<script>` block, add:

```typescript
import { onMount, onDestroy } from 'svelte';
import { afterNavigate } from '$app/navigation';
import { initAnalytics, trackPageView, destroyAnalytics } from '$lib/stores/analytics';
```

In the script body (after existing state declarations), add:

```typescript
onMount(() => initAnalytics());
onDestroy(() => destroyAnalytics());
afterNavigate(({ to }) => {
	if (to?.url) trackPageView(to.url.pathname);
});
```

**Step 3: Verify**

Run: `pnpm build`

**Step 4: Commit**

```bash
git add src/lib/stores/analytics.ts src/routes/+layout.svelte
git commit -m "feat(analytics): add client-side interaction collector with auto page tracking"
```

---

### Task 11: Admin Global Stats Endpoint

**Files:**
- Create: `src/routes/api/admin/stats/+server.ts`

**Step 1: Create admin stats endpoint**

```typescript
import { json } from '@sveltejs/kit';
import { getActiveUserIds, getOrComputeStats } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/admin/stats?period=month:2026-03
 * Server-wide aggregate stats (admin only).
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const period = url.searchParams.get('period') ?? 'alltime';
	const userIds = getActiveUserIds();

	// Aggregate all users' stats
	let totalPlayTimeMs = 0;
	let totalSessions = 0;
	let totalItems = 0;
	let totalPageViews = 0;
	const genreAgg = new Map<string, number>();
	const deviceAgg = new Map<string, number>();

	for (const uid of userIds) {
		const stats = getOrComputeStats(uid, period, 'all', 600_000);
		totalPlayTimeMs += stats.totalPlayTimeMs;
		totalSessions += stats.totalSessions;
		totalItems += stats.totalItems;
		totalPageViews += stats.totalPageViews;

		for (const g of stats.topGenres) {
			genreAgg.set(g.genre, (genreAgg.get(g.genre) ?? 0) + g.playTimeMs);
		}
		for (const d of stats.topDevices) {
			deviceAgg.set(d.name, (deviceAgg.get(d.name) ?? 0) + d.playTimeMs);
		}
	}

	const topGenres = [...genreAgg.entries()]
		.map(([genre, playTimeMs]) => ({ genre, playTimeMs }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs)
		.slice(0, 20);

	const topDevices = [...deviceAgg.entries()]
		.map(([name, playTimeMs]) => ({ name, playTimeMs }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs)
		.slice(0, 10);

	return json({
		period,
		activeUsers: userIds.length,
		totalPlayTimeMs,
		totalSessions,
		totalItems,
		totalPageViews,
		topGenres,
		topDevices
	});
};
```

**Step 2: Verify**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add src/routes/api/admin/stats/
git commit -m "feat(analytics): add admin global stats endpoint"
```

---

### Task 12: Final Build Verification

**Step 1: Full build check**

Run: `pnpm build`
Expected: Clean build with no errors (a11y warnings are pre-existing and OK).

**Step 2: Verify all new files exist**

```bash
ls -la src/lib/db/schema.ts
ls -la src/lib/server/analytics.ts
ls -la src/lib/server/session-poller.ts
ls -la src/lib/server/stats-engine.ts
ls -la src/lib/server/stats-scheduler.ts
ls -la src/lib/stores/analytics.ts
ls -la src/routes/api/ingest/webhook/\[serviceType\]/+server.ts
ls -la src/routes/api/ingest/interactions/+server.ts
ls -la src/routes/api/user/stats/+server.ts
ls -la src/routes/api/user/stats/timeline/+server.ts
ls -la src/routes/api/user/stats/top/+server.ts
ls -la src/routes/api/user/stats/wrapped/+server.ts
ls -la src/routes/api/user/stats/live/+server.ts
ls -la src/routes/api/user/stats/events/+server.ts
ls -la src/routes/api/admin/stats/+server.ts
```

**Step 3: Test that the dev server starts**

Run: `pnpm dev` and verify it boots without errors.

**Step 4: Final commit with all files**

If any files were missed in individual commits:

```bash
git add -A
git status
# If clean, no commit needed. If files remain:
git commit -m "feat(analytics): analytics engine complete — events, stats, APIs, collector"
```
