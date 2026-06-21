/**
 * Nexus Adapter Contract — v2 (Nexus-Owns-Identity).
 *
 * See _runtime-evidence/PHASE0-BLUEPRINT-FINAL.md Part A for the full design.
 *
 * The one decision everything hangs on: Nexus owns identity, permissions, and
 * ALL per-user state. Backends are pure content/execution engines, each reached
 * through ONE service credential. A user has exactly one account (their Nexus
 * account); they never link or authenticate against a backend. When Nexus talks
 * to a backend it talks AS THE INSTALL, not as the user.
 *
 * The big win: `UserCredential` is gone from the entire interface. Core methods
 * take `(config, …)` only — an adapter physically cannot act on behalf of a
 * user because it's never handed one. The model is enforced by the method
 * SIGNATURES, not by convention.
 *
 * This file is intentionally kept separate from the v1 ../contract.ts so the
 * existing app keeps compiling during the aggressive rebuild.
 */

import type { ServiceConfig, ServiceHealth } from '../types';
import type { PlaybackPlan, BrowserCaps, PlaybackSession } from '../playback';

// ─────────────────────────────────────────────────────────────────────────────
// Identity / version
// ─────────────────────────────────────────────────────────────────────────────

/** Current contract version. Adapters MUST declare exactly this. */
export const ADAPTER_CONTRACT_VERSION = 2 as const;
export type AdapterContractVersion = typeof ADAPTER_CONTRACT_VERSION;

/**
 * Adapter tier — re-derived for the Nexus-owns-identity model. The old
 * credential-acquisition tiers (`user-standalone`/`user-derived`) are deleted;
 * a user never authenticates against a backend.
 *
 * - `media-source` — a library of playable/browsable content via one service
 *   cred (Jellyfin, Plex, Invidious, Calibre-Web, RomM).
 * - `request-fulfillment` — submit an action + read status via one admin/API
 *   key (Overseerr/Seerr, Radarr/Sonarr/Lidarr, Prowlarr, Bazarr).
 * - `nexus-native` — no backend, or a backend as a compute engine over data
 *   Nexus already owns (rec engine, stats, unified continue-watching/up-next).
 */
export type AdapterTier = 'media-source' | 'request-fulfillment' | 'nexus-native';

export type MediaCapability =
	| 'movie'
	| 'show'
	| 'book'
	| 'game'
	| 'music'
	| 'live'
	| 'video'
	| 'other';

// ─────────────────────────────────────────────────────────────────────────────
// Capability declarations — the SINGLE hand-authored source of truth.
//
// Authors write `capabilities` only. The loose flags (isLibrary, searchPriority,
// pollIntervalMs, mediaTypes) are DERIVED at registration — see DerivedFlags and
// declareAdapter below. Hand-writing a derived flag is a COMPILE error.
// ─────────────────────────────────────────────────────────────────────────────

export type ServiceAuthField =
	| 'url'
	| 'apiKey'
	| 'adminUsername'
	| 'adminPassword'
	| 'urlOverride';

export type ServiceAuthKind =
	| 'api-key'
	| 'admin-login'
	| 'claimed-token'
	| 'basic'
	| 'none';

/**
 * The ONLY auth surface in v2. One service credential the admin configures
 * once. There is no per-user auth surface anywhere in the contract.
 */
export interface ServiceAuthCapability {
	/** false when anonymous reads work (e.g. Invidious public). */
	readonly required: boolean;
	/** Which config fields the adapter consumes (drives the admin form). */
	readonly fields: readonly ServiceAuthField[];
	readonly kind: ServiceAuthKind;
}

export interface SearchCapability {
	/** Lower is higher priority in unified search results. */
	readonly priority: number;
}

export interface SessionsCapability {
	/** Poll interval (ms) for pollSessions — reads the BACKEND's own sessions. */
	readonly pollIntervalMs: number;
}

/**
 * Top-level capabilities object — the single hand-authored source of truth.
 * Each flag gates a method group; the registry derives loose flags from it.
 */
export interface AdapterCapabilities {
	/** Media kinds this adapter surfaces. Drives UI/search routing. */
	readonly media?: readonly MediaCapability[];
	/** The one auth surface. Absent ⇒ no auth concept (nexus-native). */
	readonly serviceAuth?: ServiceAuthCapability;
	/** ⇒ getLibrary + getRecentlyAdded. */
	readonly library?: boolean;
	/** ⇒ search. */
	readonly search?: SearchCapability;
	/** ⇒ negotiatePlayback. */
	readonly playback?: boolean;
	/** ⇒ pollSessions. */
	readonly sessions?: SessionsCapability;
	/** ⇒ submitRequest + getRequests. */
	readonly requests?: boolean;
	/** ⇒ syncLibraryItems (for the Nexus index/rec engine). */
	readonly sync?: boolean;
	/** nexus-native only: which media-source library ids it points at. */
	readonly derivesFrom?: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived flags — computed by the registry from `capabilities` at registration.
//
// These are the loose convenience flags the rest of the app reads. Authors must
// NEVER hand-write them: declareAdapter makes doing so a compile error (see its
// signature) and the registry is the only thing that ever produces them.
// ─────────────────────────────────────────────────────────────────────────────

export interface DerivedFlags {
	/** Derived from capabilities.library. */
	readonly isLibrary: boolean;
	/** Derived from capabilities.search != null. */
	readonly isSearchable: boolean;
	/** Derived from capabilities.search.priority (Infinity when not searchable). */
	readonly searchPriority: number;
	/** Derived from capabilities.sessions.pollIntervalMs (undefined when no sessions). */
	readonly pollIntervalMs?: number;
	/** Derived from capabilities.media. */
	readonly mediaTypes: readonly MediaCapability[];
}

/** The set of derived-flag keys — used by conformance Rule E and freeze logic. */
export const DERIVED_FLAG_KEYS = [
	'isLibrary',
	'isSearchable',
	'searchPriority',
	'pollIntervalMs',
	'mediaTypes'
] as const;

/**
 * Banned v1 surface keys. Their mere PRESENCE on an adapter object proves the
 * rebuild regressed into porting the deleted identity spine back in. Rule E
 * mechanically rejects them.
 */
export const BANNED_V1_KEYS = [
	'userAuth',
	'authenticateUser',
	'createUser',
	'getUsers',
	'resetPassword',
	'refreshCredential',
	'probeCredential',
	'findAutoLinkMatch',
	'authVia',
	'derivedFrom',
	'parentRequired',
	'userLinkable',
	'adminAuth',
	'probeAdminCredential',
	'supportsRegistration',
	'supportsAccountCreation',
	'supportsPasswordStorage'
] as const;

export type BannedV1Key = (typeof BANNED_V1_KEYS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Conformance exemption escape hatch (logged loudly, greppable).
// ─────────────────────────────────────────────────────────────────────────────

export interface ConformanceExemption {
	/** The rule id to downgrade (e.g. 'D' or 'D.dead-method'). */
	readonly rule: string;
	/** Why — REQUIRED, surfaced in the warning so it can't be silent. */
	readonly reason: string;
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
	/** Contract version — MUST be 2. Rule A hard-rejects anything else. */
	readonly contractVersion: AdapterContractVersion;
	/** Adapter tier — determines which method groups are legal/required. */
	readonly tier: AdapterTier;
}

// ─────────────────────────────────────────────────────────────────────────────
// Method signature types (all install-level, no per-user credential anywhere)
// ─────────────────────────────────────────────────────────────────────────────

export type CredentialProbeResult = 'ok' | 'expired' | 'invalid';

/** Browse library items — paginated, optionally filtered by media type. */
export interface LibraryQuery {
	type?: string;
	limit?: number;
	offset?: number;
	sortBy?: string;
}

export interface LibraryPage {
	items: import('../types').UnifiedMedia[];
	total: number;
}

/**
 * Opaque Nexus attribution tag. NOT a backend credential — it is a Nexus user
 * id / reference passed through so the backend can record who asked, while the
 * adapter still acts with the single install service cred.
 */
export type NexusUserRef = string;

export interface SubmitRequestInput {
	/** TMDB / external media id. */
	externalId: string;
	type: 'movie' | 'tv';
	/** TV: season numbers being requested. */
	seasons?: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// The full NexusAdapter interface (v2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The v2 adapter contract. Adapters default-export an object satisfying this
 * interface via declareAdapter(). Field requirements depend on `tier` and
 * `capabilities`; conformance.ts validates declared capabilities match
 * implemented methods.
 *
 * NOTE: not one method takes a UserCredential. That is the contract.
 */
export interface NexusAdapter extends AdapterIdentity {
	readonly capabilities: AdapterCapabilities;

	/** Optional conformance exemptions (logged loudly). */
	readonly conformanceExempt?: readonly ConformanceExemption[];

	/** Basic health check — required for every adapter. */
	ping(config: ServiceConfig): Promise<ServiceHealth>;

	// ── serviceAuth ────────────────────────────────────────────────────────
	/** The ONLY credential probe — install-level, authed round-trip. */
	probeServiceCredential?(config: ServiceConfig): Promise<CredentialProbeResult>;

	/** Headers for proxying authenticated images (install cred only). */
	getImageHeaders?(config: ServiceConfig): Promise<Record<string, string>>;

	// ── library ⇒ getLibrary + getRecentlyAdded ─────────────────────────────
	getLibrary?(config: ServiceConfig, opts?: LibraryQuery): Promise<LibraryPage>;
	getRecentlyAdded?(config: ServiceConfig): Promise<import('../types').UnifiedMedia[]>;
	/** Fetch a single item by its source id. */
	getItem?(config: ServiceConfig, sourceId: string): Promise<import('../types').UnifiedMedia | null>;

	// ── search ⇒ search ──────────────────────────────────────────────────────
	search?(config: ServiceConfig, query: string): Promise<import('../types').UnifiedSearchResult>;

	// ── playback ⇒ negotiatePlayback ─────────────────────────────────────────
	// `ctx.nexusUserId` is Nexus's OWN identity for this request (not a backend
	// credential) — threaded so the minted stream grant is bound to the session
	// user (the copy-paste / replay defense).
	negotiatePlayback?(
		config: ServiceConfig,
		item: { id: string; type: string; title?: string },
		plan: PlaybackPlan,
		caps: BrowserCaps,
		ctx?: { nexusUserId?: string }
	): Promise<PlaybackSession>;

	// ── sessions ⇒ pollSessions ──────────────────────────────────────────────
	pollSessions?(config: ServiceConfig): Promise<import('../types').NexusSession[]>;

	// ── requests ⇒ submitRequest + getRequests ───────────────────────────────
	/** nexusUserRef = OPAQUE attribution tag, NOT a backend credential. */
	submitRequest?(
		config: ServiceConfig,
		req: SubmitRequestInput,
		nexusUserRef?: NexusUserRef
	): Promise<boolean>;
	getRequests?(
		config: ServiceConfig,
		opts?: { filter?: 'all' | 'pending' | 'approved' | 'declined' | 'available'; take?: number; skip?: number }
	): Promise<import('../types').NexusRequest[]>;
	approveRequest?(config: ServiceConfig, requestId: string): Promise<boolean>;
	denyRequest?(config: ServiceConfig, requestId: string): Promise<boolean>;

	// ── sync ⇒ syncLibraryItems ──────────────────────────────────────────────
	syncLibraryItems?(config: ServiceConfig): Promise<import('../types').SyncItem[]>;
}

/** An adapter as stored in the registry: the authored shape + derived flags. */
export type RegisteredAdapter = NexusAdapter & DerivedFlags;

// ─────────────────────────────────────────────────────────────────────────────
// declareAdapter — derive + freeze the loose flags, and make hand-writing a
// derived flag (or a banned v1 key) a COMPILE error.
//
// The trick (from the blueprint): the parameter type is
//   Omit<T, keyof DerivedFlags> & Partial<Record<keyof DerivedFlags, never>>
// so any literal you pass may NOT carry a derived-flag key with a real value
// (only `never`/absent is allowed) — TS rejects `isLibrary: true` at compile
// time. We also ban the v1 keys the same way.
// ─────────────────────────────────────────────────────────────────────────────

/** Keys an author must never hand-write: derived flags + banned v1 surface. */
type ForbiddenAuthorKey = keyof DerivedFlags | BannedV1Key;

/** Compile-time guard: forbid any forbidden key from appearing on the literal. */
type NoForbiddenKeys<T> = Omit<T, ForbiddenAuthorKey> &
	Partial<Record<ForbiddenAuthorKey, never>>;

/**
 * Derive the loose flags from capabilities. Pure — the single place derived
 * flags are ever produced.
 */
export function deriveFlags(adapter: NexusAdapter): DerivedFlags {
	const caps = adapter.capabilities;
	return {
		isLibrary: caps.library === true,
		isSearchable: caps.search != null,
		searchPriority: caps.search?.priority ?? Infinity,
		pollIntervalMs: caps.sessions?.pollIntervalMs,
		mediaTypes: caps.media ?? []
	};
}

/**
 * Declare an adapter with full type inference. Derives + freezes the loose flags
 * onto the returned object and enforces (at compile time) that the author wrote
 * neither a derived flag nor a banned v1 key.
 *
 * @returns the authored adapter augmented with frozen DerivedFlags.
 */
export function declareAdapter<T extends NexusAdapter>(
	adapter: T & NoForbiddenKeys<T>
): T & DerivedFlags {
	const derived = deriveFlags(adapter);
	const merged = { ...(adapter as T), ...derived } as T & DerivedFlags;
	return Object.freeze(merged);
}
