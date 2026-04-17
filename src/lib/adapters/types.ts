export type MediaType = 'movie' | 'show' | 'episode' | 'book' | 'game' | 'music' | 'album' | 'live' | 'video';

export type MediaStatus = 'available' | 'requested' | 'downloading' | 'missing' | 'continuing' | 'completed';

export interface UnifiedMedia {
	/** Composite ID: `${serviceId}:${sourceId}` — see `$lib/shared/ids`. */
	id: string;
	sourceId: string;
	serviceId: string;
	serviceType: string;
	type: MediaType;
	title: string;
	sortTitle?: string;
	description?: string;
	poster?: string;
	backdrop?: string;
	/** Landscape thumbnail (e.g. episode screenshot) */
	thumb?: string;
	year?: number;
	rating?: number;
	genres?: string[];
	studios?: string[];
	duration?: number; // seconds
	status?: MediaStatus;
	progress?: number; // 0-1
	metadata?: Record<string, unknown>;
	// Computed
	actionLabel?: string;
	actionUrl?: string;
	/** Direct stream URL (HLS/MP3/etc.) for inline playback */
	streamUrl?: string;
}

export interface UnifiedSearchResult {
	items: UnifiedMedia[];
	total: number;
	source: string;
}

export interface ServiceConfig {
	id: string;
	name: string;
	type: string;
	url: string;
	apiKey?: string;
	username?: string;
	password?: string;
	enabled: boolean;
}

/** Per-user credentials for a specific service (stored in user_service_credentials table) */
export interface UserCredential {
	accessToken?: string;
	externalUserId?: string;
	externalUsername?: string;
}

/** Combined config used at call-time: server config + optional user override */
export interface ResolvedConfig extends ServiceConfig {
	userCredential?: UserCredential;
}

export interface DashboardRow {
	id: string;
	title: string;
	subtitle?: string;
	items: UnifiedMedia[];
}

export interface ServiceHealth {
	serviceId: string;
	name: string;
	type: string;
	online: boolean;
	latency?: number;
	error?: string;
}

/** A unified media request (from Overseerr or future services) */
export interface NexusRequest {
	/** Composite ID: `${serviceId}:${sourceId}` */
	id: string;
	/** Service-native request ID (e.g. Overseerr request ID) */
	sourceId: string;
	serviceId: string;
	serviceType: string;
	serviceName: string;
	title: string;
	type: 'movie' | 'show' | 'book' | 'game' | 'music' | 'other';
	poster?: string;
	year?: number;
	status: 'pending' | 'approved' | 'declined' | 'available' | 'partial';
	requestedByName: string;
	requestedByExternalId: string;
	requestedAt: string;
	updatedAt?: string;
	/** TMDB/external media ID — for linking to the media detail page */
	tmdbId?: string;
	mediaUrl?: string;
	description?: string;
	genres?: string[];
	backdrop?: string;
	rating?: number;
}

/** Information about an external user (e.g. from Jellyfin GET /Users) */
export interface ExternalUser {
	externalId: string;
	username: string;
	isAdmin?: boolean;
	serviceType: string;
	/** Jellyfin user ID associated with this user (Overseerr-specific) */
	jellyfinUserId?: string;
}

/** Active playback/activity session reported by an adapter */
export interface NexusSession {
	sessionId: string;
	userId?: string;
	username?: string;
	mediaId: string;
	mediaTitle: string;
	mediaType: MediaType;
	state: 'playing' | 'paused' | 'stopped';
	progress: number;
	positionSeconds?: number;
	durationSeconds?: number;
	device?: string;
	client?: string;
	/** Media year (e.g. production year) */
	year?: number;
	/** Genre list */
	genres?: string[];
	/** Parent item ID (e.g. series ID for an episode) */
	parentId?: string;
	/** Parent item title (e.g. series name for an episode) */
	parentTitle?: string;
	/** Adapter-specific playback metadata (codecs, transcoding, etc.) */
	metadata?: Record<string, unknown>;
}

/** Item returned by syncLibraryItems for recommendation engine ingestion */
export interface SyncItem {
	sourceId: string;
	title: string;
	sortTitle?: string;
	mediaType: MediaType;
	year?: number;
	genres?: string[];
	poster?: string;
	backdrop?: string;
	duration?: number;
	rating?: number;
	tmdbId?: string;
	imdbId?: string;
}

/** Upcoming media release from calendar endpoints */
export interface CalendarItem {
	id: string;
	sourceId: string;
	serviceId: string;
	title: string;
	mediaType: MediaType;
	releaseDate: string;
	poster?: string;
	overview?: string;
	status?: 'upcoming' | 'released' | 'downloading';
}

/** Quality metadata enrichment for media items */
export interface QualityInfo {
	resolution?: string;
	hdr?: string;
	audioFormat?: string;
	audioChannels?: string;
	videoCodec?: string;
	source?: string;
	customFormats?: string[];
	qualityProfile?: string;
}

/** Extended queue item download progress metadata */
export interface QueueItemMeta {
	queueStatus: 'downloading' | 'paused' | 'queued' | 'failed' | 'warning' | 'completed';
	downloadProgress: number;
	sizeBytes?: number;
	remainingBytes?: number;
	eta?: string;
	downloadClient?: string;
	indexer?: string;
	quality?: string;
	errorMessage?: string;
}
