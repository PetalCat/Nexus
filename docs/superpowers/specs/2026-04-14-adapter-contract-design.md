# Nexus Adapter Contract — Design

**Date:** 2026-04-14
**Scope:** Formal contract for the `NexusAdapter` interface. Defines required vs optional methods by adapter tier, capability flags, auth-resilience hooks, error taxonomy, and schema additions that every adapter benefits from.
**Status:** Proposed, pending Parker approval.
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

```ts
export interface AdapterCapabilities {
  /** What kinds of content this adapter surfaces. Drives UI/search routing. */
  readonly media?: readonly MediaCapability[];

  /** Auth surface — how users authenticate against this adapter. Required for user-level tiers. */
  readonly auth?: AdapterAuthCapabilities;

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

  /** Declared parent adapters for derived tier. */
  readonly derivedFrom?: readonly string[];
  /** True if this derived adapter cannot function without a linked parent. */
  readonly parentRequired?: boolean;
}

export type MediaCapability = 'movie' | 'show' | 'book' | 'game' | 'music' | 'live' | 'video' | 'other';
```

Each capability flag **gates a group of methods**. An adapter declaring `capabilities.library: true` must implement `getLibrary`, `getRecentlyAdded`, and `getContinueWatching`. An adapter declaring `capabilities.search` must implement `search`. The type system enforces this via conditional types in the next section.

### Auth capabilities — the core of this spec

```ts
export interface AdapterAuthCapabilities {
  /**
   * True if the adapter has a persistent per-user credential. Required for
   * user-standalone and user-derived tiers. False for server-level adapters.
   */
  readonly userLinkable: true;

  /** Label for the username field in the sign-in modal. Default "Username". */
  readonly usernameLabel?: string;

  /**
   * True if the adapter supports auto-registration via authenticateUser
   * (Invidious-style — /login auto-creates unknown users) OR has a distinct
   * createUser method. Drives the "Create new account" toggle in the modal.
   */
  readonly supportsRegistration: boolean;

  /**
   * True if the adapter supports stored-password auto-refresh. Enables the
   * "Save password for auto-reconnect" checkbox in the sign-in modal. Also
   * required for the /api/user/credentials/reconnect route to work.
   */
  readonly supportsPasswordStorage: boolean;

  /**
   * True if probeCredential can be called cheaply (single round-trip) to
   * check if the stored credential still works. Used by the accounts-page
   * health probe.
   */
  readonly supportsHealthProbe: boolean;

  /**
   * Can Nexus create accounts on this service? (Jellyfin/RomM/Calibre yes;
   * Invidious no — /login handles both register and signin so this is false
   * for Invidious even though supportsRegistration is true.)
   */
  readonly supportsAccountCreation: boolean;
}
```

### Auth methods — required for user-linkable adapters

```ts
interface UserLinkableMethods {
  /**
   * Exchange username + password for a credential. Called from the sign-in
   * modal. May throw AdapterAuthError.
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
   * supportsAccountCreation=true. Returns the new credential.
   */
  createUser(
    config: ServiceConfig,
    username: string,
    password: string
  ): Promise<UserCredentialResult>;
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

### Schema additions — `user_service_credentials`

```sql
-- New migration, additive only, no data migration
ALTER TABLE user_service_credentials ADD COLUMN stored_password TEXT;
ALTER TABLE user_service_credentials ADD COLUMN stale_since TEXT;
```

- `stored_password` — nullable. Encrypted at rest via the existing Nexus credential-encryption layer. Nullable because users can opt out of password storage at link time.
- `stale_since` — nullable ISO timestamp. Null = credential is healthy. Set by the registry when auto-refresh fails or a health probe returns `'expired'` or `'invalid'`.

Drizzle schema change in `src/lib/db/schema.ts:46-60`. Migration generated via `pnpm db:generate`.

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

| Adapter | Tier | userLinkable | supportsRegistration | supportsPasswordStorage | supportsHealthProbe | supportsAccountCreation |
|---|---|---|---|---|---|---|
| Radarr | server | no | — | — | — | — |
| Sonarr | server | no | — | — | — | — |
| Lidarr | server | no | — | — | — | — |
| Prowlarr | server (enrichment) | no | — | — | — | — |
| Bazarr | server (enrichment) | no | — | — | — | — |
| Jellyfin | user-standalone | yes | yes | **yes** (already implemented ad-hoc) | yes | yes |
| Calibre-Web | user-standalone | yes | no | yes | yes (`/opds` probe) | yes |
| Invidious | user-standalone | yes | **yes** (via signin auto-register) | yes | yes | no (same as authenticate) |
| Kavita | user-standalone | yes | no | yes | yes | no |
| Plex | user-standalone | yes | no | no (OAuth token is permanent) | yes | no |
| RomM | user-standalone | yes | no | yes | yes | yes |
| Overseerr | user-derived | yes | no | no (uses parent cred) | yes | no |
| Streamystats | user-derived | yes | no | no (uses parent cred) | yes | no |

For derived adapters (`user-derived` tier), the auth hooks mostly delegate to the parent. `refreshCredential` on Overseerr calls the Jellyfin adapter's `refreshCredential` internally. This isolation is the whole point — derived adapters don't duplicate Jellyfin's refresh logic.

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

## Open questions

*None right now — the scope is big but Parker has resolved every decision point so far. Leaving this section for items that surface during implementation.*
