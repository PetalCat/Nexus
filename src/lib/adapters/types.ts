export type MediaType = 'movie' | 'show' | 'episode' | 'book' | 'game' | 'music' | 'album' | 'live' | 'video';

export type MediaStatus = 'available' | 'requested' | 'downloading' | 'missing' | 'continuing';

export interface UnifiedMedia {
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
