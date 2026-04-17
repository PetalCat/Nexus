import { getDb, getRawDb, schema } from '../db';
import { and, eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Known event types — extend these as new services/features are added.
// These are NOT enforced at runtime (eventType is a free string), but serve
// as documentation and provide autocomplete for callers.
// ---------------------------------------------------------------------------

/** Media consumption events */
export const MEDIA_EVENTS = {
	// Playback lifecycle
	PLAY_START: 'play_start',
	PLAY_STOP: 'play_stop',
	PLAY_PAUSE: 'play_pause',
	PLAY_RESUME: 'play_resume',
	PROGRESS: 'progress',
	COMPLETE: 'complete',

	// Social signals
	LIKE: 'like',
	UNLIKE: 'unlike',
	RATE: 'rate',
	WATCHLIST_ADD: 'watchlist_add',
	WATCHLIST_REMOVE: 'watchlist_remove',

	// Library management
	ADD_TO_WATCHLIST: 'add_to_watchlist',
	REMOVE_FROM_WATCHLIST: 'remove_from_watchlist',
	ADD_TO_COLLECTION: 'add_to_collection',
	REMOVE_FROM_COLLECTION: 'remove_from_collection',
	ADD_TO_LIBRARY: 'add_to_library',
	REMOVE_FROM_LIBRARY: 'remove_from_library',

	// Status changes
	MARK_WATCHED: 'mark_watched',
	MARK_UNWATCHED: 'mark_unwatched',
	SHARE: 'share',

	// Discovery / requests
	REQUEST: 'request',
	DETAIL_VIEW: 'detail_view',

	// Reading (Calibre-Web, etc.)
	READ_START: 'read_start',
	READ_STOP: 'read_stop',
	READ_PROGRESS: 'read_progress',
	READ_COMPLETE: 'read_complete',
	CHAPTER_COMPLETE: 'chapter_complete',

	// Downloads / acquisition
	DOWNLOAD_START: 'download_start',
	DOWNLOAD_COMPLETE: 'download_complete',
	DOWNLOAD_FAILED: 'download_failed',
	IMPORT: 'import'
} as const;

/** UI interaction events */
export const INTERACTION_EVENTS = {
	PAGE_VIEW: 'page_view',
	CLICK: 'click',
	SEARCH: 'search',
	SCROLL_DEPTH: 'scroll_depth',
	CARD_HOVER: 'card_hover',
	CARD_CLICK: 'card_click',
	ROW_SCROLL: 'row_scroll',
	FILTER_CHANGE: 'filter_change',
	SORT_CHANGE: 'sort_change',
	DETAIL_VIEW: 'detail_view',
	REQUEST_SUBMIT: 'request_submit',
	SETTING_CHANGE: 'setting_change',
	LOGIN: 'login',
	LOGOUT: 'logout',
	LIKE_BUTTON: 'like_button',
	RATE_BUTTON: 'rate_button',
	WATCHLIST_BUTTON: 'watchlist_button',
	SHARE_BUTTON: 'share_button',
	PLAYER_ACTION: 'player_action', // play, pause, seek, volume, fullscreen, subtitle change
	NOTIFICATION_CLICK: 'notification_click',
	RECOMMENDATION_CLICK: 'recommendation_click'
} as const;

/** Known media types — extend as new content types are added */
export const MEDIA_TYPES = {
	MOVIE: 'movie',
	SHOW: 'show',
	EPISODE: 'episode',
	BOOK: 'book',
	COMIC: 'comic',
	MANGA: 'manga',
	GAME: 'game',
	MUSIC: 'music',
	ALBUM: 'album',
	TRACK: 'track',
	PODCAST: 'podcast',
	LIVE: 'live',
	AUDIOBOOK: 'audiobook'
} as const;

/** Known service types — mirrors adapter registry */
export const SERVICE_TYPES = {
	JELLYFIN: 'jellyfin',
	CALIBRE: 'calibre',
	ROMM: 'romm',
	OVERSEERR: 'overseerr',
	STREAMYSTATS: 'streamystats',
	RADARR: 'radarr',
	SONARR: 'sonarr',
	LIDARR: 'lidarr',
	PROWLARR: 'prowlarr',
	BAZARR: 'bazarr'
} as const;

// ---------------------------------------------------------------------------
// Webhook handler registry — add handlers for new service types here
// ---------------------------------------------------------------------------

export type WebhookHandler = (request: Request) => Promise<{ ok: boolean; event?: string; skipped?: boolean; error?: string }>;

const webhookHandlers = new Map<string, WebhookHandler>();

/** Register a webhook handler for a service type. */
export function registerWebhookHandler(serviceType: string, handler: WebhookHandler) {
	webhookHandlers.set(serviceType, handler);
}

/** Get the webhook handler for a service type. */
export function getWebhookHandler(serviceType: string): WebhookHandler | undefined {
	return webhookHandlers.get(serviceType);
}

// ---------------------------------------------------------------------------
// Poller plugin registry — add pollers for new service types here
// ---------------------------------------------------------------------------

export type PollerFn = () => Promise<void>;

const pollerPlugins = new Map<string, { fn: PollerFn; intervalTicks: number }>();

/** Register a poller plugin. intervalTicks = how many 10s ticks between runs (e.g. 6 = every 60s). */
export function registerPoller(name: string, fn: PollerFn, intervalTicks = 1) {
	pollerPlugins.set(name, { fn, intervalTicks });
}

/** Get all registered pollers. */
export function getPollerPlugins() {
	return pollerPlugins;
}

// ---------------------------------------------------------------------------
// User resolution helpers — map external IDs back to Nexus users
// ---------------------------------------------------------------------------

/**
 * Resolve a Nexus userId from an external service user ID.
 * Useful in webhooks/pollers where you only have the service's user ID.
 *
 * When `serviceId` is known (the common case in pollers/webhooks), pass it —
 * lookups can then hit idx_user_service_creds_ext (SEARCH) instead of scanning
 * every credential row. Omitting it falls back to the external_user_id-only
 * path, which is rare and tolerated as a legacy escape hatch.
 */
export function resolveNexusUserId(
	externalUserId: string,
	serviceId?: string
): string | null {
	const db = getDb();
	const where = serviceId
		? and(
				eq(schema.userServiceCredentials.serviceId, serviceId),
				eq(schema.userServiceCredentials.externalUserId, externalUserId)
			)
		: eq(schema.userServiceCredentials.externalUserId, externalUserId);
	const cred = db
		.select()
		.from(schema.userServiceCredentials)
		.where(where)
		.get();
	return cred?.userId ?? null;
}

/**
 * Get all user credentials for a given service (for pollers that need to iterate users).
 */
export function getCredsForService(serviceId: string) {
	const db = getDb();
	return db
		.select()
		.from(schema.userServiceCredentials)
		.where(eq(schema.userServiceCredentials.serviceId, serviceId))
		.all();
}

// ---------------------------------------------------------------------------
// Playback metadata builder — standardized metadata extraction
// ---------------------------------------------------------------------------

export interface PlaybackMetadata {
	resolution?: string;       // "4K", "1080p", "720p", "480p"
	videoCodec?: string;       // "hevc", "h264", "av1"
	audioCodec?: string;       // "truehd-atmos", "eac3", "aac", "flac"
	audioChannels?: string;    // "7.1", "5.1", "stereo"
	audioTrackLanguage?: string;
	hdr?: string;              // "dolby-vision", "hdr10", "hdr10+", "sdr"
	bitrate?: number;
	isTranscoding?: boolean;
	transcodeReason?: string;
	streamType?: string;       // "direct-play", "direct-stream", "transcode"
	subtitleLanguage?: string;
	subtitleFormat?: string;   // "srt", "ass", "pgs"
	closedCaptions?: boolean;
	// Reading metadata (future)
	pageNumber?: number;
	totalPages?: number;
	chapterNumber?: number;
	totalChapters?: number;
	readingDevice?: string;
	// Game metadata
	platform?: string;
	platformSlug?: string;
	userStatus?: string;
	lastPlayed?: string;
	// Generic
	[key: string]: unknown;
}

/**
 * Build resolution string from pixel height.
 */
export function heightToResolution(height: number): string {
	if (height >= 2160) return '4K';
	if (height >= 1080) return '1080p';
	if (height >= 720) return '720p';
	if (height >= 480) return '480p';
	return `${height}p`;
}

/**
 * Build audio channel string from channel count.
 */
export function channelsToLabel(channels: number): string {
	if (channels > 6) return '7.1';
	if (channels > 2) return '5.1';
	return 'stereo';
}

// ---------------------------------------------------------------------------
// Media action ingestion (non-playback events)
// ---------------------------------------------------------------------------

export interface MediaActionInput {
	userId: string;
	serviceId: string;
	serviceType: string;
	actionType: string;
	mediaId: string;
	mediaType: string;
	mediaTitle?: string;
	metadata?: Record<string, unknown>;
	timestamp?: number;
}

/** Insert a single media action (rating, mark_watched, etc.). Fire-and-forget. */
export function emitMediaAction(input: MediaActionInput): void {
	try {
		const db = getDb();
		db.insert(schema.mediaActions)
			.values({
				userId: input.userId,
				serviceId: input.serviceId,
				serviceType: input.serviceType,
				actionType: input.actionType,
				mediaId: input.mediaId,
				mediaType: input.mediaType,
				mediaTitle: input.mediaTitle ?? null,
				metadata: input.metadata ? JSON.stringify(input.metadata) : null,
				timestamp: input.timestamp ?? Date.now()
			})
			.run();
	} catch (e) {
		console.error('[analytics] Failed to emit media action:', e);
	}
}

// ---------------------------------------------------------------------------
// Play session helpers (used by poller + progress endpoints)
// ---------------------------------------------------------------------------

/** Find an open (not ended) session by session_key. */
export function findOpenSessionByKey(sessionKey: string) {
	const db = getRawDb();
	return db.prepare(
		`SELECT * FROM play_sessions WHERE session_key = ? AND ended_at IS NULL`
	).get(sessionKey) as any | undefined;
}

/** Find an open session for a user + media combination. */
export function findOpenSession(userId: string, mediaId: string, serviceId: string) {
	const db = getRawDb();
	return db.prepare(
		`SELECT * FROM play_sessions WHERE user_id = ? AND media_id = ? AND service_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`
	).get(userId, mediaId, serviceId) as any | undefined;
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

