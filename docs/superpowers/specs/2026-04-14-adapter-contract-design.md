# Nexus Adapter Contract — Design

**Date:** 2026-04-14
**Scope:** Formal contract for the `NexusAdapter` interface. Defines required vs optional methods by adapter tier, capability flags, auth-resilience hooks, error taxonomy, and schema expectations that every adapter benefits from.
**Status:** Revised 2026-04-14 to apply the `adminAuth`/`userAuth` split from the approved umbrella spec.
**Depends on:** [`2026-04-14-service-account-umbrella-design.md`](./2026-04-14-service-account-umbrella-design.md) (umbrella, approved)
**Tracking:** ProjectOS Nexus #2 — *Pluggable adapter architecture*.

## Problem

The current `ServiceAdapter` interface (`src/lib/adapters/base.ts`) is a **loose collection of optional methods**. Nearly every method is marked `?`, which creates real problems:

1. **No contract guarantee** — consuming routes have to null-check every adapter call (`adapter?.ping?.(…)`), which hides missing implementations until runtime.
2. **No capability discovery** — there's no way to ask "does this adapter support user registration?" without duck-typing `typeof adapter.createUser === 'function'`, which is what the accounts page does today.
3. **No auth-resilience layer** — each adapter handles token expiry, refresh, and error reporting on its own (or doesn't). Jellyfin has ad-hoc stored-credential refresh. Invidious silently swallows 401s into empty arrays. Calibre used to do both and neither.
4. **No shared UI contract** — the accounts-page sign-in modal is bespoke per service, and there's no way to build a reusable `SignInCard` / `StaleCredentialBanner` because the data it needs isn't standardized.
5. **Not plugin-safe** — the current interface couldn't be frozen as a third-party contract because it's too fuzzy and too much of it is "implement if you feel like it".

This spec replaces `ServiceAdapter` with `NexusAdapter`: a **tiered, capability-driven contract** that distinguishes what adapters MUST provide from what they MAY provide, and defines the auth-resilience and error-reporting patterns uniformly.

## Adapter landscape as of 2026-04-14

13 adapters in `src/lib/adapters/`, classified into three tiers:

**Tier 1 — Server-level** *(no per-user credentials)*
- Radarr, Sonarr, Lidarr — movie/show/music automation
- Prowlarr — indexer manager (`isEnrichmentOnly: true`)
- Bazarr — subtitle manager (`isEnrichmentOnly: true`)

**Tier 2 — User-level standalone** *(each user has their own credential)*
- Jellyfin — media server, token refresh via stored creds
- Calibre-Web — just migrated to OPDS Basic auth
- Invidious — SID cookie, no refresh (the bug that spawned this whole spec)
- Kavita — comic library
- Plex — media server, token auth
- RomM — ROM library, `createUser` implemented

**Tier 3 — User-level derived** *(depend on a parent adapter's credential)*
- Overseerr — `derivedFrom: ['jellyfin', 'plex']`, `parentRequired: false`
- Streamystats — `derivedFrom: ['jellyfin']`, `parentRequired: true`

The contract has to accommodate all three tiers cleanly without forcing server-level adapters to implement no-op user-cred hooks and without letting user-level adapters skip required resilience methods.

## Architecture

### The new interface — `NexusAdapter`

```ts
// src/lib/adapters/contract.ts
export const ADAPTER_CONTRACT_VERSION = 1 as const;

export type AdapterTier = 'server' | 'user-standalone' | 'user-derived';

export interface AdapterIdentity {
  /** Unique adapter type key matching `services.type` in the DB. */
  readonly id: string;
  /** Human-readable name shown in the UI. */
  readonly displayName: string;
  /** Default port for the setup wizard. */
  readonly defaultPort: number;
  /** 2-char badge abbreviation (e.g. 'JF'). */
  readonly abbreviation: string;
  /** Brand color for badges and accents. */
  readonly color: string;
  /** Icon name (resolved by the ServiceIcon component). */
  readonly icon?: string;
  /** Contract version this adapter was written against. Enables compat shims. */
  readonly contractVersion: typeof ADAPTER_CONTRACT_VERSION;
  /** Adapter tier — determines which methods are required. */
  readonly tier: AdapterTier;
}

export interface NexusAdapter extends AdapterIdentity {
  // ── Required for every tier ──────────────────────────────────────
  ping(config: ServiceConfig): Promise<ServiceHealth>;

  // ── Capability flags (declarative) ───────────────────────────────
  readonly capabilities: AdapterCapabilities;

  // ── Optional methods (scoped by capability flag) ─────────────────
  // See sections below — each capability unlocks a method group.
}
```

Every adapter **must** implement `ping` regardless of tier. Everything else is scoped by `capabilities`.

### Capability flags

Per the umbrella spec (*Tier and the "admin-vs-user" question — resolved*), auth capabilities are **split into two orthogonal objects**: `adminAuth` (does this adapter need install-wide admin credentials?) and `userAuth` (does this adapter have per-user credentials?). An adapter can have either, both, or neither.

```ts
export interface AdapterCapabilities {
  /** What kinds of content this adapter surfaces. Drives UI/search routing. */
  readonly media?: readonly MediaCapability[];

  /**
   * Admin credential surface — install-wide material used for management
   * operations (list users, create users, reset passwords) and for
   * unauthenticated reads. Absent = adapter has no concept of admin creds.
   */
  readonly adminAuth?: AdapterAdminAuthCapabilities;

  /**
   * User credential surface — per-user material used for personal
   * interactions with the service. Absent = adapter is server-level only.
   */
  readonly userAuth?: AdapterUserAuthCapabilities;

  /** Library browsing (getLibrary, getRecentlyAdded, getContinueWatching). */
  readonly library?: boolean;

  /** Unified search. Enables `search(config, query, userCred)`. */
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

export type MediaCapability = 'movie' | 'show' | 'book' | 'game' | 'music' | 'live' | 'video' | 'other';
```

Each capability flag **gates a group of methods**. An adapter declaring `capabilities.library: true` must implement `getLibrary`, `getRecentlyAdded`, and `getContinueWatching`. An adapter declaring `capabilities.search` must implement `search`. The type system enforces this via conditional types in the next section.

**Why split admin and user auth:** a single adapter can have both (Jellyfin: admin account for user management + per-user tokens for personal data), just admin (Radarr: API key only, no user concept), just user (Invidious: SID cookies only, no admin surface), or neither (a purely public adapter, hypothetical today). Folding these into one `auth` field forced awkward gymnastics to express "this adapter needs an admin API key AND per-user tokens with separate health tracking." The split reflects reality.

### Admin auth capabilities

```ts
export interface AdapterAdminAuthCapabilities {
  /**
   * True when the adapter requires install-wide admin credentials to
   * function at all. If false (and userAuth is defined), the adapter
   * can work with just user credentials — no admin setup needed.
   */
  readonly required: boolean;

  /**
   * Which fields on the services row the adapter consumes. The settings/admin
   * page uses this to decide which inputs to render in the service config form.
   */
  readonly fields: ReadonlyArray<'url' | 'adminApiKey' | 'adminUsername' | 'adminPassword' | 'adminUrlOverride'>;

  /**
   * True if the adapter can cheaply verify its admin credential is still
   * working. Enables server-level health tracking in /admin/services.
   */
  readonly supportsHealthProbe: boolean;
}
```

### User auth capabilities

```ts
export interface AdapterUserAuthCapabilities {
  /**
   * Always true for adapters that declare userAuth. The field is present
   * to make the type self-documenting and to catch misuses where userAuth
   * is declared but empty.
   */
  readonly userLinkable: true;

  /** Label for the username field in the Connect Account modal. Default "Username". */
  readonly usernameLabel?: string;

  /**
   * True if the adapter supports user registration from within Nexus.
   * Drives the "Create new account" toggle in the Connect Account modal.
   *
   * Note: for Invidious-style services where /login handles both signin
   * and register (auto-registers unknown users when registration is
   * enabled), this is TRUE even though there's no distinct createUser
   * method. supportsAccountCreation below distinguishes the two.
   */
  readonly supportsRegistration: boolean;

  /**
   * True if the adapter has a distinct createUser method that creates an
   * account from scratch (as opposed to inferring registration from a
   * signin flow). Services: Jellyfin, RomM, Calibre-Web.
   *
   * False for Invidious (signin does double duty), Plex (no account creation
   * via API), Kavita (no account creation surface).
   *
   * Required to expose the "Create managed account" flow per the umbrella's
   * managed-account model.
   */
  readonly supportsAccountCreation: boolean;

  /**
   * True if the adapter supports stored-password auto-refresh. Enables the
   * "Save password for auto-reconnect" checkbox in the Connect Account modal
   * and the POST /api/user/credentials/reconnect route.
   */
  readonly supportsPasswordStorage: boolean;

  /**
   * True if probeCredential can be called cheaply (single round-trip) to
   * check if the stored credential still works. Used by the accounts-page
   * health probe. Typically always true for user-standalone adapters; may
   * be true or false for user-derived adapters depending on whether a
   * cheap probe exists.
   */
  readonly supportsHealthProbe: boolean;

  /**
   * For derived-tier adapters only. Lists the *service types* this adapter
   * can auto-link from. Matches the umbrella's auto-linking model where a
   * user can pick which parent service provides their derived credential.
   *
   * Duplicates capabilities.derivedFrom for type-level discovery — kept
   * both for ergonomics.
   */
  readonly derivedFrom?: readonly string[];
}
```

### Admin auth methods — required when `adminAuth.required === true`

```ts
interface AdminAuthMethods {
  /**
   * Cheap authed probe against the admin credential. Verifies the admin
   * API key / token / account is still valid. Returns 'ok' | 'expired' |
   * 'invalid'. Required when capabilities.adminAuth.supportsHealthProbe is true.
   *
   * Called from /admin/services health checks and from the contract's
   * shared health-probe machinery.
   */
  probeAdminCredential(config: ServiceConfig): Promise<'ok' | 'expired' | 'invalid'>;
}
```

### User auth methods — required when `userAuth.userLinkable === true`

```ts
interface UserAuthMethods {
  /**
   * Exchange username + password for a credential. Called from the Connect
   * Account modal. May throw AdapterAuthError.
   */
  authenticateUser(
    config: ServiceConfig,
    username: string,
    password: string
  ): Promise<UserCredentialResult>;

  /**
   * Cheap authed probe. Returns 'ok' if the credential works, 'expired' if
   * the session/token is dead, 'invalid' if creds are outright wrong (stored
   * password no longer works). Used by accounts-page health probe + read
   * methods that want to pre-check. Required when supportsHealthProbe=true.
   */
  probeCredential(
    config: ServiceConfig,
    userCred: UserCredential
  ): Promise<'ok' | 'expired' | 'invalid'>;

  /**
   * Refresh an expired credential using a stored password. The shared
   * registry layer handles stored-password lookup and calls this method.
   * Throws AdapterAuthError on failure. Required when supportsPasswordStorage=true.
   */
  refreshCredential(
    config: ServiceConfig,
    userCred: UserCredential,
    storedPassword: string
  ): Promise<UserCredentialResult>;

  /**
   * Headers needed to proxy authenticated images (cover art, channel art).
   * Default returns empty.
   */
  getImageHeaders?(
    config: ServiceConfig,
    userCred: UserCredential
  ): Promise<Record<string, string>>;
}

interface AccountCreationMethods {
  /**
   * Create a new account on the service. Only required when
   * userAuth.supportsAccountCreation=true. Returns the new credential.
   *
   * See the umbrella spec's managed-account section for the surrounding
   * lifecycle semantics (Nexus-owned password, managed→owned migration,
   * confirm-then-delete on unlink).
   */
  createUser(
    config: ServiceConfig,
    username: string,
    password: string
  ): Promise<UserCredentialResult>;
}

interface DerivedAuthMethods {
  /**
   * For user-derived adapters only. Given a just-linked parent credential,
   * find a matching account on the derived service (or return null if no
   * match). Called by the shared auto-link machinery when a user links a
   * parent service that this adapter can derive from.
   *
   * The match function is adapter-specific: Overseerr matches by
   * `jellyfinUserId === parent.externalUserId`; Streamystats copies the
   * Jellyfin token directly; future adapters might match by email or OAuth
   * `sub` claim.
   *
   * Required for all user-derived tier adapters. The auto-linking sub-spec
   * defines the consent dialog that wraps this method; the contract only
   * requires the match function itself.
   */
  findAutoLinkMatch(
    config: ServiceConfig,
    parent: LinkedParentContext
  ): Promise<UserCredentialResult | null>;
}

/** Context passed to derived adapters during auto-linking. */
export interface LinkedParentContext {
  /** The parent service's type (e.g. 'jellyfin', 'plex'). */
  readonly parentType: string;
  /** The parent service's DB id (for parent_service_id resolution). */
  readonly parentServiceId: string;
  /** The parent credential's external user id — the primary match key. */
  readonly parentExternalUserId: string;
  /** The parent credential's external username (fallback match hint). */
  readonly parentExternalUsername?: string;
  /** The parent's access token, in case the derived adapter needs to call the parent API. */
  readonly parentAccessToken?: string;
  /** The parent's ServiceConfig (needed for pass-through API calls to the parent). */
  readonly parentConfig: ServiceConfig;
}
```

### Error taxonomy — `AdapterAuthError`

```ts
// src/lib/adapters/errors.ts
export type AdapterAuthErrorKind =
  | 'expired'              // session/token died, retry after refreshCredential
  | 'invalid'              // credentials are wrong (stored password no longer works)
  | 'rate-limited'         // service is rate-limiting us
  | 'registration-disabled'// user tried to create an account but the service blocks it
  | 'unreachable'          // network/timeout/DNS failure
  | 'permission-denied';   // authed but lacks the required role

export class AdapterAuthError extends Error {
  constructor(
    message: string,
    public readonly kind: AdapterAuthErrorKind,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'AdapterAuthError';
  }
}
```

**Propagation rule:** every adapter method that talks to an authenticated endpoint must throw `AdapterAuthError` (with a specific `kind`) when it encounters an auth-related failure. Generic `Error` is reserved for non-auth problems. Consuming routes catch `AdapterAuthError` specifically and route to the stale-credential UI flow.

**Read-method error model:** methods like `getLibrary`, `getContinueWatching`, `search` etc. **must NOT silently return `[]` on `AdapterAuthError`**. Instead, they throw up the stack. The consuming route catches and returns `{ items: [], error: { kind: 'auth_expired' | ... } }` to the client, which renders the stale-credential banner. (This is a behavior change from today's pattern and is covered in the Invidious spec.)

### Schema — reference to umbrella

The full target schema for `services` and `user_service_credentials` is defined in the umbrella spec's *Target data model* section. The contract just references those columns — it does not redefine them. Key points for contract consumers:

- **`user_service_credentials.stored_password`** — nullable, encrypted. Populated at link time if the user opted in. Consumed by `refreshCredential`.
- **`user_service_credentials.stale_since`** — nullable ISO timestamp. Set by the shared registry layer when auto-refresh fails or a health probe returns `'expired'`/`'invalid'`. Cleared on successful reconnect.
- **`user_service_credentials.parent_service_id`** — nullable FK to `services.id`. Set by derived adapters during auto-linking.
- **`user_service_credentials.auto_linked`** — boolean. True when the credential was created by the auto-link flow.
- **`user_service_credentials.nexus_managed`** — boolean. True when the credential was created by `createUser` (Nexus owns the downstream account per the umbrella's managed-account model).
- **`user_service_credentials.extra_auth`** — nullable JSON. Adapter-specific auth state (refresh tokens, device IDs, OAuth session).
- **`services.admin_cred_stale_since`** / **`services.admin_cred_last_probed_at`** — admin-side health tracking, updated by `probeAdminCredential`.

**Destructive migrations are fine** per the umbrella (Parker, 2026-04-14). The migration in `drizzle/` reflects the target schema directly, not a minimum diff.

### Shared registry layer — `src/lib/adapters/registry/`

The registry moves from a single 80-line file into a small module that handles contract-wide concerns:

```
src/lib/adapters/registry/
  index.ts                 # public registry API (get, list, register)
  auth-refresh.ts          # stored-password auto-refresh plumbing
  health-probe.ts          # parallel health probes for the accounts page
  reconnect.ts             # /api/user/credentials/reconnect handler
  errors.ts                # AdapterAuthError (moved from shared location)
```

**`auth-refresh.ts`** — when any adapter call throws `AdapterAuthError('expired')`, the shared layer checks for a stored password and calls `adapter.refreshCredential`. On success, the SID/token is updated in the DB and the original call is retried once. On failure, `stale_since` is set.

This means **adapter methods don't retry — the shared layer does**. Each adapter stays dumb about refresh semantics; it just throws `AdapterAuthError` and the registry handles the rest.

**`health-probe.ts`** — `probeAllUserCredentials(userId)` iterates the user's linked credentials, calls `adapter.probeCredential` in parallel with a 5s timeout per call, and updates `stale_since` accordingly. Called by the accounts page server load. Results cached per-user for 60s to avoid probe storms.

**`reconnect.ts`** — POST `/api/user/credentials/reconnect { serviceId }`. Reads the stored password, calls `adapter.refreshCredential`, updates the DB, clears `stale_since`. Returns 200 on success, 4xx with `AdapterAuthError.kind` as a response field on failure.

### Shared UI components — `src/lib/components/account-linking/`

Three components that any route can import:

```
src/lib/components/account-linking/
  AccountLinkModal.svelte       # generic sign-in modal with Register toggle
  SignInCard.svelte             # "Sign in to X to unlock Y, Z" inline card
  StaleCredentialBanner.svelte  # red "Your session expired — reconnect" banner
```

Props are **service-agnostic** — each component takes a `service: AccountServiceSummary` (the shape already computed by the accounts-page server load) plus callbacks for the actions. No Invidious-specific anything.

**`AccountLinkModal`** reads `service.capabilities.auth` to decide:
- Whether to show the "Save password for auto-reconnect" checkbox (`supportsPasswordStorage`)
- Whether to show the "Create new account" toggle (`supportsRegistration`)
- What the username label should say (`usernameLabel`)
- Which error messages are valid (`AdapterAuthError.kind` → human-readable string via shared `errorCopy.ts`)

**`SignInCard`** takes a `features: string[]` prop (e.g. `['subscriptions', 'history', 'playlists']`) to render contextual copy, but all other styling and behavior is driven by the service metadata.

**`StaleCredentialBanner`** reads `service.staleSince` and `service.capabilities.auth.supportsPasswordStorage` to decide between a one-click auto-reconnect button (if password stored) and a button that opens the sign-in modal prefilled with the known username.

### How existing adapters map to the new contract

The split between admin and user auth creates two orthogonal columns. Each adapter is classified on both dimensions.

| Adapter | Tier | `adminAuth.required` | admin fields | `userAuth.userLinkable` | `supportsRegistration` | `supportsAccountCreation` | `supportsPasswordStorage` |
|---|---|---|---|---|---|---|---|
| Radarr | server | **yes** | `url`, `adminApiKey` | no | — | — | — |
| Sonarr | server | **yes** | `url`, `adminApiKey` | no | — | — | — |
| Lidarr | server | **yes** | `url`, `adminApiKey` | no | — | — | — |
| Prowlarr | server (enrichment) | **yes** | `url`, `adminApiKey` | no | — | — | — |
| Bazarr | server (enrichment) | **yes** | `url`, `adminApiKey` | no | — | — | — |
| Jellyfin | user-standalone | optional (for mgmt) | `url`, `adminUsername`, `adminPassword` | **yes** | yes | **yes** | **yes** (already implemented ad-hoc) |
| Calibre-Web | user-standalone | optional | `url`, `adminUsername`, `adminPassword` | **yes** | no | **yes** | yes |
| Invidious | user-standalone | no | — | **yes** | **yes** (signin auto-registers) | no (same call) | yes |
| Kavita | user-standalone | optional | `url`, `adminUsername`, `adminPassword` | **yes** | no | no | yes |
| Plex | user-standalone | **yes** | `url`, `adminApiKey` (X-Plex-Token) | **yes** | no | no | no (OAuth token is permanent) |
| RomM | user-standalone | **yes** | `url`, `adminApiKey` | **yes** | no | **yes** | yes |
| Overseerr | user-derived | **yes** | `url`, `adminApiKey` | **yes** | no | no | no (derives from parent) |
| Streamystats | user-derived | **yes** | `url`, `adminApiKey`, `adminUrlOverride` | **yes** | no | no | no (derives from parent) |

**Reading the table:**
- **Server-level adapters** (Radarr, Sonarr, Lidarr, Prowlarr, Bazarr) have only `adminAuth`. No per-user anything.
- **Invidious** is unique: **no admin surface at all**. `adminAuth` is absent. Users each have their own SID cookie; the admin never sees it.
- **Jellyfin / Calibre-Web / Kavita** have *optional* admin auth — the adapter works with just user credentials, but admin creds unlock management operations like `createUser` and `getUsers`.
- **Plex / RomM** require admin credentials for content browsing; per-user tokens layer on top.
- **Overseerr / Streamystats** are derived — they require admin credentials to run and get user creds from a parent service via `findAutoLinkMatch`.

### Derived adapters and auto-linking

Derived adapters (tier `user-derived`) implement `findAutoLinkMatch` as their primary user-auth path. The shared registry calls it when a user links a parent service, passing a `LinkedParentContext`. Match semantics are adapter-specific:

- **Overseerr** — calls its own `getUsers(config)` with admin creds, filters for a row where `jellyfinUserId === parent.parentExternalUserId`. Returns the matched user's external id as the derived credential. If no match and the parent is Jellyfin, optionally triggers Overseerr's "import Jellyfin user" flow and retries.
- **Streamystats** — directly copies the parent's access token (for Streamystats, the Jellyfin token IS the credential). No matching needed, just validation that the token works against the Streamystats endpoint.

Derived adapters **still implement `probeCredential` and `refreshCredential`**, but their implementations typically delegate: Streamystats's `refreshCredential` re-fetches the parent's access token via the registry; Overseerr's `refreshCredential` re-runs the match function if the parent got re-authed.

**The derived-adapter contract is thin on purpose.** The complex auto-linking orchestration (consent dialogs, per-service parent choice, conflict resolution) lives in the auto-linking sub-spec and the shared registry layer, NOT in each adapter. Each adapter just has to answer one question: *"given this parent credential, what's my corresponding user credential?"*

### Contract versioning

`ADAPTER_CONTRACT_VERSION = 1` is exported as a constant. Every adapter's `contractVersion` field must match to be loaded by the registry. The plugin-loader spec (deliverable #2 in the initiative) will define how old versions get compat-shimmed when the contract evolves.

For the initial migration, every in-tree adapter sets `contractVersion: 1` as part of its migration diff.

## Migration plan — preview

Covered in detail in deliverable #3 of ProjectOS Nexus #2. Summary:

- **Tier 1 (server-level)** adapters get a mechanical migration: add `tier: 'server'`, add `capabilities`, delete per-user auth methods they don't implement. ~5 minutes each.
- **Tier 2 (user-standalone)** adapters get real work: implement `probeCredential` + `refreshCredential` against their existing auth surface, wire into `AdapterAuthError`. Jellyfin's ad-hoc refresh moves onto the shared layer. ~30 minutes each, but Jellyfin goes first as the reference implementation.
- **Tier 3 (user-derived)** adapters get thin `refreshCredential` implementations that delegate to the parent adapter's method.

**Invidious is the last adapter migrated** — it serves as the "does the contract actually work in anger" test. The detailed Invidious work is the separate spec (`2026-04-14-invidious-auth-ux-design.md`), which will be revised to reference this contract.

## Testing

1. **Contract conformance tests** — a single `contract.test.ts` that, for every adapter registered via `src/lib/adapters/registry.ts`, asserts:
   - All required methods for its tier are implemented
   - `capabilities` object exists and is well-formed
   - `contractVersion === 1`
   - Declared capabilities match implemented methods (e.g. if `capabilities.library: true`, `getLibrary` exists)
2. **Auth-refresh integration tests** — fetch-mock driven tests that exercise:
   - `adapter.authenticateUser → store → probeCredential('ok') → force expiry → probeCredential('expired') → registry auto-refresh → retry succeeds`
   - Same flow with a bad stored password → `refreshCredential` throws `AdapterAuthError('invalid')` → registry marks stale
3. **Error-propagation tests** — assert that read methods throw `AdapterAuthError` instead of returning `[]` on auth failure (this is a breaking change for Invidious, benign for others)
4. **Shared-component snapshot tests** — `AccountLinkModal`, `SignInCard`, `StaleCredentialBanner` render correctly for each of the three tiers

## Out of scope

- **Plugin loader** — covered in deliverable #2 of the initiative (separate spec). This spec defines the *contract*; the loader spec defines *how plugins implementing the contract get discovered and loaded*.
- **Adapter SDK as a published npm package** — v2 concern. For now, the contract types are exported from `src/lib/adapters/contract.ts` and live in-tree.
- **Sandboxing** — also a plugin-loader concern.
- **Multi-instance per adapter** (switching between Invidious instances seamlessly) — separate spec.
- **Rewriting non-auth adapter surfaces** — the contract migration does not touch `normalizeVideo`, `getLibrary` implementations, DeArrow enrichment, etc. Working code stays.

## Parker decisions baked in (2026-04-14)

- **Migrate everything** — all 13 adapters, not just userLinkable ones
- **Hooks required for userLinkable** (Parker: *"I like #2"*)
- **Adapter-contract spec first**, Invidious becomes the first real consumer
- **Pluggable** = external plugin bundles long-term; this spec enables that by being strict enough to freeze as a v1 contract
- **Destructive migrations are fine in dev** — the schema section references the umbrella's target shape directly, no additive-only posture
- **Split adminAuth/userAuth** (via umbrella's resolution of the tier-vs-admin-auth tension)
- **Terminology follows the umbrella**: `Connect account` as primary button, `Linked account` as record label, `Reconnect` for stale state — all adapters and UI follow these conventions

## Open questions

*None right now — the scope is big but Parker has resolved every decision point so far. Leaving this section for items that surface during implementation.*
