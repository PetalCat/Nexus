/**
 * Nexus Adapter Contract — the formal interface every adapter must satisfy.
 *
 * See docs/superpowers/specs/2026-04-14-adapter-contract-design.md for the
 * full design rationale and method gating rules.
 *
 * This file is the single source of truth for the adapter interface. The
 * existing ServiceAdapter (src/lib/adapters/base.ts) is being migrated onto
 * this contract — both shapes co-exist during the transition; see
 * base.ts for the compatibility re-exports.
 */

import type { ServiceConfig, ServiceHealth, UserCredential } from './types';

/** Current contract version. Plugins must match this to be loaded. */
export const ADAPTER_CONTRACT_VERSION = 1 as const;
export type AdapterContractVersion = typeof ADAPTER_CONTRACT_VERSION;

/**
 * Adapter tier — describes how user credentials are obtained (if at all).
 * Orthogonal to whether the adapter needs admin credentials; see
 * capabilities.adminAuth for that dimension.
 *
 * - `server`: no per-user credentials at all. Think Radarr, Sonarr.
 * - `user-standalone`: each user has their own credential obtained via
 *   authenticateUser. Think Jellyfin, Invidious, Calibre-Web.
 * - `user-derived`: credentials are derived from a parent adapter's
 *   credential. Think Overseerr (from Jellyfin), Streamystats (from Jellyfin).
 */
export type AdapterTier = 'server' | 'user-standalone' | 'user-derived';

export type MediaCapability = 'movie' | 'show' | 'book' | 'game' | 'music' | 'live' | 'video' | 'other';

// ─────────────────────────────────────────────────────────────────────────────
// Capability declarations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Admin credential surface — install-wide material used for management
 * operations (list users, create users, reset passwords) and for
 * unauthenticated reads. Absent means the adapter has no concept of admin
 * credentials.
 */
export interface AdapterAdminAuthCapabilities {
	/**
	 * True when the adapter requires install-wide admin credentials to
	 * function at all. False means the adapter can work with just user
	 * credentials — no admin setup required.
	 */
	readonly required: boolean;

	/**
	 * Which fields on the services row the adapter consumes. The admin
	 * service-config form uses this to decide which inputs to render.
	 */
	readonly fields: ReadonlyArray<AdminAuthField>;

	/**
	 * True if the adapter can cheaply verify its admin credential is still
	 * working. Enables server-level health tracking.
	 */
	readonly supportsHealthProbe: boolean;
}

export type AdminAuthField =
	| 'url'
	| 'adminApiKey'
	| 'adminUsername'
	| 'adminPassword'
	| 'adminUrlOverride';

/**
 * User credential surface — per-user material used for personal interactions
 * with the service. Absent means the adapter is server-level only.
 */
export interface AdapterUserAuthCapabilities {
	/**
	 * Always true for adapters that declare userAuth. Present to make the
	 * type self-documenting.
	 */
	readonly userLinkable: true;

	/** Label for the username field in the Connect Account modal. */
	readonly usernameLabel?: string;

	/**
	 * True if the adapter supports user registration. Drives the
	 * "Create new account" toggle in the Connect Account modal. For
	 * Invidious-style services where /login handles both signin and register,
	 * this is TRUE even though there's no distinct createUser method.
	 * supportsAccountCreation below distinguishes the two.
	 */
	readonly supportsRegistration: boolean;

	/**
	 * True if the adapter has a distinct createUser method. Services with
	 * this capability: Jellyfin, RomM, Calibre-Web. False for Invidious
	 * (signin does double duty).
	 */
	readonly supportsAccountCreation: boolean;

	/**
	 * True if the adapter supports stored-password auto-refresh. Enables the
	 * "Save password for auto-reconnect" checkbox and the reconnect API.
	 */
	readonly supportsPasswordStorage: boolean;

	/**
	 * True if probeCredential can be called cheaply. Used by the
	 * accounts-page health probe.
	 */
	readonly supportsHealthProbe: boolean;

	/**
	 * For derived-tier adapters: the service types this adapter can auto-link
	 * from. Duplicated from capabilities.derivedFrom for type-level discovery.
	 */
	readonly derivedFrom?: readonly string[];
}

/**
 * Top-level capabilities object. Each flag gates a method group — declaring
 * the capability means the corresponding methods must be implemented.
 */
export interface AdapterCapabilities {
	/** Media kinds this adapter surfaces. Drives UI/search routing. */
	readonly media?: readonly MediaCapability[];

	/** Admin credential surface. Absent = no admin concept. */
	readonly adminAuth?: AdapterAdminAuthCapabilities;

	/** User credential surface. Absent = server-level only. */
	readonly userAuth?: AdapterUserAuthCapabilities;

	/** Library browsing enabled — requires getLibrary + getRecentlyAdded. */
	readonly library?: boolean;

	/** Unified search enabled — requires search method. */
	readonly search?: {
		/** Lower is higher priority in unified search results. */
		priority: number;
	};

	/** Request management (Overseerr-style). */
	readonly requests?: boolean;

	/** Live playback session polling. */
	readonly sessions?: {
		pollIntervalMs: number;
	};

	/** Recommendation/sync item export. */
	readonly sync?: boolean;

	/** Calendar/upcoming releases. */
	readonly calendar?: boolean;

	/** Enrichment-only adapter — no user-facing content. */
	readonly enrichmentOnly?: boolean;

	/** Declared parent adapter types for derived tier. */
	readonly derivedFrom?: readonly string[];
	/** True if this derived adapter cannot function without a linked parent. */
	readonly parentRequired?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Method signature types
// ─────────────────────────────────────────────────────────────────────────────

/** Return shape from authenticateUser / createUser / refreshCredential. */
export interface UserCredentialResult {
	accessToken: string;
	externalUserId: string;
	externalUsername: string;
	/** Adapter-specific auth state, stored in user_service_credentials.extra_auth as JSON. */
	extraAuth?: Record<string, unknown>;
}

/** Result of a credential probe. */
export type CredentialProbeResult = 'ok' | 'expired' | 'invalid';

/**
 * Context passed to derived adapters during auto-linking. The shared registry
 * constructs this from the parent credential that was just linked and passes
 * it to the derived adapter's findAutoLinkMatch method.
 */
export interface LinkedParentContext {
	/** The parent service's type (e.g. 'jellyfin', 'plex'). */
	readonly parentType: string;
	/** The parent service's DB id. */
	readonly parentServiceId: string;
	/** The parent credential's external user id — the primary match key. */
	readonly parentExternalUserId: string;
	/** The parent credential's external username (fallback match hint). */
	readonly parentExternalUsername?: string;
	/** The parent's access token, in case the derived adapter needs to call the parent API. */
	readonly parentAccessToken?: string;
	/** The parent's ServiceConfig. */
	readonly parentConfig: ServiceConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter identity (base fields every adapter has)
// ─────────────────────────────────────────────────────────────────────────────

export interface AdapterIdentity {
	/** Unique adapter type key matching services.type. */
	readonly id: string;
	/** Human-readable name shown in UI. */
	readonly displayName: string;
	/** Default port for the setup wizard. */
	readonly defaultPort: number;
	/** 2-char badge abbreviation (e.g. 'JF'). */
	readonly abbreviation: string;
	/** Brand color for badges. */
	readonly color: string;
	/** Icon name resolved by the ServiceIcon component. */
	readonly icon?: string;
	/** Contract version this adapter was written against. */
	readonly contractVersion: AdapterContractVersion;
	/** Adapter tier — determines which method groups are required. */
	readonly tier: AdapterTier;
}

// ─────────────────────────────────────────────────────────────────────────────
// The full NexusAdapter interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The full adapter contract. Plugins default-export an object satisfying this
 * interface. The field requirements depend on `tier` and `capabilities` —
 * see the design spec for the rules.
 *
 * Every adapter must implement `ping` regardless of tier. Everything else is
 * scoped by capabilities. The conformance test suite validates that declared
 * capabilities match implemented methods.
 */
export interface NexusAdapter extends AdapterIdentity {
	readonly capabilities: AdapterCapabilities;

	/** Basic health check — required for every adapter. */
	ping(config: ServiceConfig): Promise<ServiceHealth>;

	// ── Admin auth methods (required when capabilities.adminAuth.required) ──
	/** Cheap probe of the admin credential. Required when supportsHealthProbe. */
	probeAdminCredential?(config: ServiceConfig): Promise<CredentialProbeResult>;

	// ── User auth methods (required when capabilities.userAuth) ────────────
	/** Exchange username + password for a credential. */
	authenticateUser?(
		config: ServiceConfig,
		username: string,
		password: string,
		mode?: 'signin' | 'register'
	): Promise<UserCredentialResult>;

	/** Cheap probe of a user credential. Required when supportsHealthProbe. */
	probeCredential?(
		config: ServiceConfig,
		userCred: UserCredential
	): Promise<CredentialProbeResult>;

	/** Refresh an expired credential using a stored password. Required when supportsPasswordStorage. */
	refreshCredential?(
		config: ServiceConfig,
		userCred: UserCredential,
		storedPassword: string
	): Promise<UserCredentialResult>;

	/** Create a new account. Required when userAuth.supportsAccountCreation. */
	createUser?(
		config: ServiceConfig,
		username: string,
		password: string
	): Promise<UserCredentialResult>;

	/** Headers for proxying authenticated images. */
	getImageHeaders?(
		config: ServiceConfig,
		userCred?: UserCredential
	): Promise<Record<string, string>>;

	// ── Derived-tier only ──────────────────────────────────────────────────
	/** Given a parent credential, find a matching account on this derived service. */
	findAutoLinkMatch?(
		config: ServiceConfig,
		parent: LinkedParentContext
	): Promise<UserCredentialResult | null>;
}

/**
 * Identity helper for declaring adapters with full type inference. Plugin
 * authors use this so their editor gives them autocomplete on every field.
 */
export function declareAdapter<T extends NexusAdapter>(adapter: T): T {
	return adapter;
}
