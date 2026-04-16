/**
 * Base adapter interface for Nexus service integrations.
 *
 * To create a custom adapter:
 * 1. Create a new file in src/lib/adapters/ (e.g. my-service.ts)
 * 2. Implement the ServiceAdapter interface
 * 3. Register it in src/lib/adapters/registry.ts
 *
 * Only implement the methods your service supports — all are optional
 * except `ping`, `id`, `displayName`, and `defaultPort`.
 */

import type { ServiceConfig, ServiceHealth, NexusRequest, UnifiedMedia, UnifiedSearchResult, UserCredential, ExternalUser, NexusSession, SyncItem, CalendarItem } from './types';
import type { NegotiatePlaybackFn } from './playback';
import type {
	AdapterCapabilities,
	AdapterContractVersion,
	AdapterTier,
	CredentialProbeResult,
	LinkedParentContext,
	UserCredentialResult
} from './contract';

// Re-export contract types so downstream imports can grab them from base.ts
// without separately importing contract.ts.
export type {
	AdapterCapabilities,
	AdapterContractVersion,
	AdapterTier,
	CredentialProbeResult,
	LinkedParentContext,
	UserCredentialResult
};

export type OnboardingCategory =
	| 'media-server'
	| 'automation'
	| 'requests'
	| 'subtitles'
	| 'analytics'
	| 'video'
	| 'games'
	| 'books'
	| 'indexer';

export interface OnboardingMeta {
	category: OnboardingCategory;
	description: string;
	priority: number;
	icon?: string;
	requiredFields: ('url' | 'apiKey' | 'username' | 'password')[];
	supportsAutoAuth?: boolean;
}

export interface ServiceAdapter {
	/** Unique identifier matching the `type` field in the services table */
	readonly id: string;

	/** Human-readable name shown in the UI */
	readonly displayName: string;

	/** Default port for this service (used in setup wizard hints) */
	readonly defaultPort: number;

	/** Brand color for UI badges and accents (hex string, e.g. '#00a4dc') */
	readonly color?: string;

	/** 2-char abbreviation for compact badges (e.g. 'JF'). Falls back to first 2 chars of id. */
	readonly abbreviation?: string;

	/** Icon name or SVG string for the service */
	readonly icon?: string;

	/** Categories of media this adapter provides */
	readonly mediaTypes?: Array<'movie' | 'show' | 'book' | 'game' | 'music' | 'live' | 'video' | 'other'>;

	/**
	 * Whether individual users can/should link their own accounts.
	 * - true  → user-level service (Jellyfin, Overseerr, Calibre, RomM)
	 * - false / undefined → server-level only (Radarr, Sonarr, etc.)
	 */
	readonly userLinkable?: boolean;

	// ---- Capability metadata ----

	/** Whether this adapter provides a browsable media library */
	readonly isLibrary?: boolean;

	/** Whether this adapter should appear in unified search */
	readonly isSearchable?: boolean;

	/** Search result priority (0 = highest). Defaults to Infinity. */
	readonly searchPriority?: number;

	/** Delegates user auth to another adapter type (e.g. 'jellyfin') */
	readonly authVia?: string;

	/** No user-facing content — background enrichment only (e.g. Bazarr, Prowlarr) */
	readonly isEnrichmentOnly?: boolean;

	/** Parent adapter types this service can auto-link through. Order = preference. */
	readonly derivedFrom?: string[];

	/** If true, this service ONLY works through a parent — no manual link fallback. */
	readonly parentRequired?: boolean;

	/** Poll interval in ms for pollSessions. Defaults to 10000 (10s). */
	readonly pollIntervalMs?: number;

	// ─── New contract fields (2026-04-14) ──────────────────────────────────
	// These are optional during the migration; adapters populate them
	// gradually. Once every adapter has them, they become required. See
	// docs/superpowers/specs/2026-04-14-adapter-contract-design.md.

	/** Contract version this adapter was written against. */
	readonly contractVersion?: AdapterContractVersion;

	/** Adapter tier — describes how user credentials are obtained. */
	readonly tier?: AdapterTier;

	/** Formal capability declaration. Supersedes the loose per-field flags above. */
	readonly capabilities?: AdapterCapabilities;

	/** Check if the service is reachable */
	ping(config: ServiceConfig): Promise<ServiceHealth>;

	// ─── New auth-resilience hooks (2026-04-14) ────────────────────────────
	// Optional during migration. Required for tier='user-standalone' and
	// 'user-derived' once migration is complete.

	/** Cheap probe of the admin credential — required when capabilities.adminAuth.supportsHealthProbe. */
	probeAdminCredential?(config: ServiceConfig): Promise<CredentialProbeResult>;

	/** Cheap probe of a user credential — required when capabilities.userAuth.supportsHealthProbe. */
	probeCredential?(config: ServiceConfig, userCred: UserCredential): Promise<CredentialProbeResult>;

	/** Refresh an expired user credential using a stored password — required when capabilities.userAuth.supportsPasswordStorage. */
	refreshCredential?(config: ServiceConfig, userCred: UserCredential, storedPassword: string): Promise<UserCredentialResult>;

	/** Derived-tier only — given a parent credential, find the corresponding user credential on this adapter. */
	findAutoLinkMatch?(config: ServiceConfig, parent: LinkedParentContext): Promise<UserCredentialResult | null>;

	/** Items the user is currently in progress on */
	getContinueWatching?(config: ServiceConfig, userCred?: UserCredential): Promise<UnifiedMedia[]>;

	/** Recently added items */
	getRecentlyAdded?(config: ServiceConfig, userCred?: UserCredential): Promise<UnifiedMedia[]>;

	/** Full-text search */
	search?(config: ServiceConfig, query: string, userCred?: UserCredential): Promise<UnifiedSearchResult>;

	/** Fetch a single item by its source ID */
	getItem?(config: ServiceConfig, sourceId: string, userCred?: UserCredential): Promise<UnifiedMedia | null>;

	/** Items currently being downloaded / in queue */
	getQueue?(config: ServiceConfig): Promise<UnifiedMedia[]>;

	/** Trending / recommended items */
	getTrending?(config: ServiceConfig, userCred?: UserCredential): Promise<UnifiedMedia[]>;

	/** Browse library items — paginated, optionally filtered by media type */
	getLibrary?(
		config: ServiceConfig,
		opts?: { type?: string; limit?: number; offset?: number; sortBy?: string; platformId?: number },
		userCred?: UserCredential
	): Promise<{ items: UnifiedMedia[]; total: number }>;

	/** Live TV channels */
	getLiveChannels?(config: ServiceConfig, userCred?: UserCredential): Promise<UnifiedMedia[]>;

	/** Submit a request for new media. For TV, pass `seasons` as array of season numbers. */
	requestMedia?(config: ServiceConfig, tmdbId: string, type: 'movie' | 'tv', userCred?: UserCredential, seasons?: number[]): Promise<boolean>;

	/** Browse/discover content — paginated, for infinite scroll */
	discover?(
		config: ServiceConfig,
		opts?: { page?: number; category?: string; genreId?: string; networkId?: string },
		userCred?: UserCredential
	): Promise<{ items: UnifiedMedia[]; hasMore: boolean }>;

	/**
	 * Label for the "username" field on the account-linking form.
	 * Defaults to "Username" when absent. Set to "Email" for services that use email login.
	 * Set to "Jellyfin Username" when the service is configured for Jellyfin auth.
	 */
	readonly authUsernameLabel?: string;

	readonly onboarding?: OnboardingMeta;

	// ---- User-level methods (only relevant when userLinkable = true) ----

	/** Authenticate a user against this service; returns an access token + userId */
	authenticateUser?(config: ServiceConfig, username: string, password: string, mode?: 'signin' | 'register'): Promise<{ accessToken: string; externalUserId: string; externalUsername: string; extraAuth?: Record<string, unknown> }>;

	/** Create a new user on this service; returns auth info for the created user */
	createUser?(config: ServiceConfig, username: string, password: string): Promise<{ accessToken: string; externalUserId: string; externalUsername: string }>;

	/** List all users on this service (for migration) */
	getUsers?(config: ServiceConfig): Promise<ExternalUser[]>;

	/** Reset a user's password on this service (admin API) */
	resetPassword?(config: ServiceConfig, externalUserId: string, newPassword: string): Promise<void>;

	/** Fetch similar items for a given item ID */
	getSimilar?(config: ServiceConfig, sourceId: string, userCred?: UserCredential): Promise<UnifiedMedia[]>;

	/** Fetch all episodes for a given season of a show */
	getSeasonEpisodes?(config: ServiceConfig, seriesId: string, seasonNumber: number, userCred?: UserCredential): Promise<UnifiedMedia[]>;

	/** Upcoming media releases within a date range */
	getCalendar?(config: ServiceConfig, start: string, end: string,
		userCred?: UserCredential): Promise<CalendarItem[]>;

	// ---- Request management (Overseerr and similar) ----

	/**
	 * List media requests. Admins (no userCred / admin API key) see all requests;
	 * users with a session cookie see only their own.
	 */
	getRequests?(
		config: ServiceConfig,
		opts?: { filter?: 'all' | 'pending' | 'approved' | 'declined' | 'available'; take?: number; skip?: number },
		userCred?: UserCredential
	): Promise<NexusRequest[]>;

	/** Fast count of pending requests (no enrichment) — for badge display */
	getPendingCount?(config: ServiceConfig): Promise<number>;

	/** Approve a request by its sourceId — requires admin credentials */
	approveRequest?(config: ServiceConfig, requestId: string): Promise<boolean>;

	/** Decline a request by its sourceId — requires admin credentials */
	denyRequest?(config: ServiceConfig, requestId: string): Promise<boolean>;

	// ---- Extended methods (adapter consolidation) ----

	/** Poll active playback/activity sessions */
	pollSessions?(config: ServiceConfig, userCred?: UserCredential): Promise<NexusSession[]>;

	/** Sync all library items for recommendation engine */
	syncLibraryItems?(config: ServiceConfig, userCred?: UserCredential): Promise<SyncItem[]>;

	/** Auth headers needed to proxy images from this service */
	getImageHeaders?(config: ServiceConfig, userCred?: UserCredential): Promise<Record<string, string>>;

	/** Sub-items: seasons, albums, tracks, platforms, collections */
	getSubItems?(config: ServiceConfig, parentId: string, type: string,
		opts?: { limit?: number; offset?: number; sort?: string },
		userCred?: UserCredential): Promise<{ items: UnifiedMedia[]; total: number }>;

	/** Detail for child items: album tracks, season episodes */
	getSubItemDetail?(config: ServiceConfig, parentId: string, childId: string,
		userCred?: UserCredential): Promise<UnifiedMedia[]>;

	/** Related items: same-author books, instant mix, similar games */
	getRelated?(config: ServiceConfig, sourceId: string,
		userCred?: UserCredential): Promise<UnifiedMedia[]>;

	/** Browsing categories: genres, tags, platforms, authors */
	getCategories?(config: ServiceConfig,
		userCred?: UserCredential): Promise<Array<{ id: string; name: string; count?: number; image?: string }>>;

	/** Set item status: read/unread, favorite, watched */
	setItemStatus?(config: ServiceConfig, sourceId: string,
		status: Record<string, unknown>, userCred?: UserCredential): Promise<void>;

	/** Collection/playlist CRUD */
	manageCollection?(config: ServiceConfig,
		action: 'create' | 'update' | 'delete' | 'addItems' | 'removeItems',
		data: { id?: string; name?: string; itemIds?: string[]; [key: string]: unknown },
		userCred?: UserCredential): Promise<{ id: string } | void>;

	/** Channel/creator subscriptions */
	manageSubscription?(config: ServiceConfig,
		action: 'subscribe' | 'unsubscribe',
		channelId: string, userCred?: UserCredential): Promise<void>;

	/** Upload binary content (save states, save files) */
	uploadContent?(config: ServiceConfig, parentId: string, type: string,
		blob: Blob, fileName: string, userCred?: UserCredential): Promise<void>;

	/** Download binary content (books, ROMs, save states) */
	downloadContent?(config: ServiceConfig, sourceId: string,
		format?: string, userCred?: UserCredential): Promise<Response>;

	/** Enrich an existing item with additional metadata */
	enrichItem?(config: ServiceConfig, item: UnifiedMedia,
		enrichmentType?: string, userCred?: UserCredential): Promise<UnifiedMedia>;

	/** Fetch service-specific data that doesn't map to UnifiedMedia */
	getServiceData?(config: ServiceConfig, dataType: string,
		params?: Record<string, unknown>,
		userCred?: UserCredential): Promise<unknown>;

	/** Negotiate a playback session for a media item */
	negotiatePlayback?: NegotiatePlaybackFn;
}
