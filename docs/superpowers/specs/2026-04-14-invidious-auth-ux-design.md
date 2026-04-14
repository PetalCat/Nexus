# Invidious Auth + UX Rework — Design

**Date:** 2026-04-14
**Scope:** Fix the two intertwined "nightmares" around Invidious account management — backend auth rot AND UX discoverability.
**Status:** Proposed, pending Parker approval.

## Problem

Two related problems, one coherent fix.

### Problem 1 — Backend auth rot (silent failures)

When an Invidious SID cookie expires or is invalidated, Nexus silently fails across at least eight different code paths:

1. **`invFetch` (`src/lib/adapters/invidious.ts:138-140`) doesn't detect expired SIDs.** A 401 from a dead SID is indistinguishable from a real error — it just throws `Invidious /api/v1/auth/foo -> 401` up the stack.
2. **No stored password**, so no auto-refresh. Unlike Jellyfin (which recently gained token refresh from stored credentials), Invidious only stores the SID. When it dies, the user must manually unlink + relink through the settings/accounts UI.
3. **Every adapter read method swallows the 401 into `[]`.** `getContinueWatching`, `getLibrary`, `getCalendar`, and `search` all wrap calls in `try { ... } catch { return []; }`. The feed just appears empty with no visible failure mode.
4. **SID-cookie handling is hand-rolled in 7 different route files.** Every route that proxies to Invidious has its own `headers['Cookie'] = \`SID=${userCred.accessToken}\`` block, with its own timeout and error handling. No shared helper. Fixing a bug means fixing it 7 times.
5. **Accounts page has no health probe.** Settings/accounts shows Invidious as `✓ Linked as <username>` even when the SID is dead. Users can't tell the credential is broken until something else fails.
6. **`authenticateUser` always re-logs in** — no attempt to test the existing SID first. Public instances rate-limit `/login`; users can get locked out from too many retries.
7. **Single-cookie extraction.** The regex `/SID=([^;]+)/` captures one cookie from one Set-Cookie header. Fragile if the instance or a proxy ever sends multiple cookies.
8. **`getWatchHistory` returns bare video ID strings**, so `getContinueWatching` does N+1 round trips. Any expired SID during those round trips gets silently filtered out of the results.

### Problem 2 — UX discoverability (the "I don't know how to log in" nightmare)

Traced through `/videos/+page.svelte:445-494`, `/videos/subscriptions/+page.svelte:61-67`, and the settings/accounts page:

1. **`/videos` has zero inline affordance** to link an Invidious account. When `hasInvidious && !hasLinkedAccount`, the subscription feed section simply doesn't render. No banner, no button, no callout.
2. **`/videos/subscriptions`, `/videos/history`, `/videos/playlists` show dead-end text** like *"Link your account in settings to see subscriptions."* — no button, no modal launcher. The user is told to go do it somewhere else.
3. **The settings/accounts page is not linked** from any nav drawer or main-route entry point. It's only discoverable by typing `/settings/accounts` directly.
4. **Even when found, the link modal** uses generic copy (*"Sign in to Invidious"*) with no explanation of what Invidious is, what linking unlocks, what instance the user is connecting to, or how to register for a new account.
5. **`authenticateUser` error messages are opaque.** `Invidious auth failed (status 200) — check credentials` gives the user no information about what actually went wrong (wrong password vs registration disabled vs rate limited vs unreachable vs CSRF mismatch).
6. **`createUser` was correctly removed** in commit `e347328` because it was identical to `authenticateUser` and falsely surfaced as a "Create Managed" button. But Nexus now has NO account-creation story for Invidious at all — if a user doesn't already have an account on the configured instance, there's no way to get one from within Nexus.

## Empirical confirmation

- `/videos/+page.svelte:216` gates the subscription feed on `data.hasLinkedAccount && data.hasInvidious` — when false, the section just doesn't render. No "else" branch.
- `/videos/subscriptions/+page.svelte:67` is the literal text *"Link your account in settings to see subscriptions."* — no actionable element.
- `/settings/accounts/+page.server.ts:47-95` iterates configs and shows every `userLinkable` service — but the page is only reachable by URL.
- Invidious `/login` with `action=signin` auto-registers unknown users when the instance's `registration_enabled: true`. Same HTTP call handles both register and signin — confirmed in commit `e347328`'s removal rationale.
- The sign-in modal in `/settings/accounts/+page.svelte:360-508` exists and works, but has no instance-URL display, no "register" toggle, no password-storage disclosure, and no password-storage opt-in.

## Architecture

### File layout — Calibre-style split, NOT a rewrite

The current 655-line monolith has working code (normalizer, playlist/subscription helpers, DeArrow enrichment) that shouldn't be thrown out. Split along the auth boundary instead:

```
src/lib/adapters/invidious.ts              # thin ServiceAdapter shim (like calibre.ts)
src/lib/adapters/invidious/
  client.ts                                # invidiousFetch — THE single auth+fetch helper
  auth.ts                                  # formAuth + stored-password auto-refresh + stale tracking
  normalize.ts                             # moved verbatim from current file
  helpers.ts                               # subscriptions/playlists/history/comments — moved verbatim
  types.ts                                 # InvidiousVideo, InvidiousAuthError, InvidiousAuthMode
  __tests__/client.test.ts                 # retry + stale detection tests (fetch-mock driven)
```

### New module contracts

**`client.ts` — single entry point for every Invidious HTTP call**

```ts
export class InvidiousAuthError extends Error {
  constructor(
    message: string,
    public readonly kind: 'expired' | 'invalid' | 'rate-limited' | 'registration-disabled' | 'unreachable',
    public readonly retryAfterMs?: number
  ) { super(message); }
}

interface FetchOptions {
  /** When true, auto-refresh the SID on 401 using stored credentials and retry once. Default: true. */
  autoRefresh?: boolean;
  /** Timeout override (default 8000ms). */
  timeoutMs?: number;
  /** Extra request init (headers/body/method). */
  init?: RequestInit;
}

export async function invidiousFetch<T = unknown>(
  config: ServiceConfig,
  path: string,
  userCred: UserCredential | undefined,
  opts?: FetchOptions
): Promise<T>;
```

**Behavior:**
- Always applies the `Cookie: SID=...` header when `userCred?.accessToken` is present.
- Detects 401 responses on `/api/v1/auth/*` paths and throws `InvidiousAuthError('expired')`.
- Detects 429 → `InvidiousAuthError('rate-limited', retryAfterMs)` from `Retry-After` header.
- Distinguishes "instance unreachable" (network error, timeout) from "instance responded with an error".
- When `autoRefresh: true` (default) and the error kind is `'expired'` and stored credentials exist, calls `auth.ts:reauthenticate` and retries the original request exactly once. Second failure throws.
- Returns `undefined` for 204/empty responses, otherwise `response.json()`.

**Consumers:** `invidious.ts` adapter methods + all 7 route files that currently hand-roll the cookie header.

**`auth.ts` — form auth + stored-password re-auth + stale tracking**

```ts
export async function formAuth(
  config: ServiceConfig,
  username: string,
  password: string,
  mode: 'signin' | 'register'
): Promise<string>;

export async function reauthenticate(
  config: ServiceConfig,
  userCred: UserCredential
): Promise<string>; // new SID

export function markStale(userId: string, serviceId: string): void;
export function clearStale(userId: string, serviceId: string): void;
```

- `formAuth` takes an explicit `mode`. Both modes POST to `/login?type=invidious` with the same fields. In `register` mode, the adapter additionally scans the HTTP-200 response for Invidious's "registration disabled" flash text and throws `InvidiousAuthError('registration-disabled')` if present. Behaves identically to `signin` mode on success.
- `reauthenticate` is called by `client.ts` when `autoRefresh` triggers. Reads the stored password from `user_service_credentials`, calls `formAuth('signin')`, writes the new SID back. Throws `InvidiousAuthError('invalid')` if the stored password no longer works.
- `markStale` / `clearStale` update the new `stale_since` column. `markStale` is called on auto-refresh failure (or on any `InvidiousAuthError('invalid' | 'registration-disabled')`).
- Captures *all* cookies from the login response (not just SID) into a `name=value; ...` cookie string, to handle instances that set PREFS or CSRF tokens alongside SID. Stores only SID in `accessToken` for backward compatibility; additional cookies are stored under `user_service_credentials.extra_cookies` (new nullable column).

**Schema change — `user_service_credentials`**

```sql
ALTER TABLE user_service_credentials ADD COLUMN stored_password TEXT;
ALTER TABLE user_service_credentials ADD COLUMN stale_since TEXT; -- ISO timestamp
```

- `stored_password` is nullable. Encrypted at rest via the existing Nexus credential-encryption layer. Users can opt out at link time or via "Forget my password" on the accounts page.
- `stale_since` is null when the credential is healthy; set to an ISO timestamp when auto-refresh fails or a health probe rejects.

The Drizzle schema in `src/lib/db/schema.ts:46-60` gets two new nullable columns. Migration generated via `pnpm db:generate`.

*(Dropped `extra_cookies` per 2026-04-14 Parker decision — YAGNI. The adapter captures only `SID`. If a specific instance later proves to need additional cookies, add the column then.)*

### Prong A — backend fix summary (5 items)

1. **Centralize** — new `invidiousFetch` helper. Every adapter method + every route file uses it. Delete the 7 hand-rolled `Cookie: SID=...` blocks. *~30 min for the helper, ~1 hour to migrate all callers.*
2. **Auto-refresh** — opt-in `stored_password`. On `InvidiousAuthError('expired')`, re-auth via `reauthenticate`, update SID, retry once. *~1 hour.*
3. **`stale_since` column + health probe** — schema migration. On accounts-page load, for each linked Invidious credential, do one cheap authed call (`GET /api/v1/auth/preferences`) in parallel. Update `stale_since` accordingly. *~1 hour.*
4. **Stop eating errors** — replace `catch { return []; }` in 4 read methods with a typed catch. On `InvidiousAuthError`, mark the credential stale and return `{ items: [], error: 'auth_expired' }` or similar. The consumer UI reads the error state from the page-server-load. *~30 min.*
5. **Actionable errors from `authenticateUser`** — inspect Invidious response HTML for flash text (`"Wrong username or password"`, `"Registration is disabled"`, `"captcha"`) and map to `InvidiousAuthError` kinds with human-readable messages. *~30 min.*

### Prong B — UX fix summary (5 items)

6. **New `SignInCard.svelte` component** — reusable card that renders *"Sign in to Invidious to see subscriptions, history, and playlists"* with a single "Sign in" button. Opens the link modal directly (imported from the accounts page, or extracted into a shared `AccountLinkModal.svelte` — preferred). Mounted on `/videos`, `/videos/subscriptions`, `/videos/history`, `/videos/playlists` when `hasInvidious && !hasLinkedAccount`.
7. **`StaleCredentialBanner.svelte`** — shows on the same pages when `stale_since` is set. One-click "Reconnect" button that attempts silent re-auth first (using stored password if present), falling back to the sign-in modal prefilled with the known username. Text is explicit: *"Your session on `video.parker.dev` expired. Reconnecting..."*
8. **Sign-in modal rework** — extract into shared `AccountLinkModal.svelte`. For Invidious specifically:
   - Show the instance URL the user is connecting to.
   - Show a "Save password for auto-reconnect" checkbox, defaulting checked. Copy: *"Nexus encrypts and stores this password locally so your session can refresh automatically when Invidious expires it. Uncheck to require manual reconnect each time."*
   - Inline *"Create new account"* toggle that reveals a confirm-password field and changes submit to `mode: 'register'`. When the adapter returns `registration-disabled`, the toggle is disabled with an explanation.
   - Error messages render the structured `InvidiousAuthError.kind` with human copy:
     - `invalid` → *"Username or password doesn't match."*
     - `registration-disabled` → *"This instance doesn't allow new accounts. Ask the admin, or choose another instance."*
     - `rate-limited` → *"Too many attempts. Try again in 5 minutes."*
     - `unreachable` → *"Can't reach the Invidious instance. Is the URL correct?"*
9. **Accounts-page discoverability — three entry points** (Parker: *"All of the above"*):
   - **User-menu dropdown** (top-right avatar): add an *"Accounts"* entry → `/settings/accounts`.
   - **Sidebar**: add a permanent *"Accounts"* link in the sidebar settings section (next to existing settings entries).
   - **Settings landing page**: create `/settings/+page.svelte` (if not already present) as an index listing Accounts, Playback, etc. as distinct sections. This is the long-term home; the other two entries are additional affordances that jump directly to the accounts subsection.

   All three routes land at the same `/settings/accounts` page. No separate routes — just multiple entry points.
10. **Password-storage indicator + forget button on accounts page** — each linked service row with a stored password shows a small lock icon with tooltip *"Password stored for auto-reconnect"*. A "Forget password" menu item clears `stored_password` while keeping the credential linked (session-only mode).

### Data flow — user-visible narrative

**First link (new user):**
1. User lands on `/videos`. Inline `SignInCard` reads *"Sign in to Invidious (`video.parker.dev`) to see your subscriptions, history, and playlists."*
2. User clicks "Sign in". `AccountLinkModal` opens showing the instance URL, a sign-in form, a "Create new account" toggle, and the "Save password for auto-reconnect" checkbox.
3. User enters credentials (or toggles to create), submits. On success, modal closes, toast shows *"Connected to video.parker.dev"*, page invalidates, subscription feed starts loading.
4. On failure, structured error renders inline in the modal with specific actionable copy.

**Auto-refresh (silent):**
1. User opens `/videos/subscriptions`. Page load calls `adapter.getSubscriptionFeed(config, userCred)`.
2. `invidiousFetch` sends the stored SID. Invidious returns 401 (session expired).
3. `invidiousFetch` catches, detects `autoRefresh: true`, calls `auth.ts:reauthenticate`, gets a new SID, updates the DB, retries the request. User sees nothing — just a slightly slower page load.
4. If reauthenticate also fails (stored password changed), `markStale` fires and the user's next page load shows the `StaleCredentialBanner`.

**Stale credential (visible):**
1. User opens `/videos/subscriptions`. Page server load detects `stale_since` is set. Does NOT call the adapter (no point). Passes `stale: true` to the client.
2. Page renders `StaleCredentialBanner` at the top with *"Your Invidious session on `video.parker.dev` expired. Reconnect →"*.
3. User clicks "Reconnect". If a stored password exists, client POSTs to `/api/user/credentials/reconnect`. Server calls `reauthenticate`. On success, `stale_since` clears, page invalidates, banner disappears.
4. If no stored password (or reauth fails), `AccountLinkModal` opens prefilled with the known username. User enters password, same flow as first link.

### Caching

- `stale_since` is read on every relevant page load (cheap — one indexed column). No caching.
- Health probes on the accounts page are cached for 60 seconds keyed by `{userId}:{serviceId}` — avoids a probe storm on repeated visits.
- The subscription feed cache (`videos:subfeed:${userId}`) is invalidated whenever credentials change OR when `stale_since` is set/cleared.

### Error model

- `InvidiousAuthError` is the only error type that crosses the adapter/client boundary. All other errors propagate as ordinary `Error` instances with structured messages.
- Adapter read methods catch `InvidiousAuthError` specifically, mark stale, and return `{ items: [], error: 'auth_expired' }`. Other errors bubble up to Nexus's standard error handler.
- Route handlers that wrap the adapter can inspect `result.error` to decide whether to render a stale banner or an empty state.

## Testing

1. **`client.ts` unit tests** (vitest, fetch-mock driven):
   - Happy path — authed GET returns parsed JSON.
   - 401 with `autoRefresh: false` — throws `InvidiousAuthError('expired')`.
   - 401 with `autoRefresh: true` and stored password — re-auth succeeds, request retries, returns data.
   - 401 with `autoRefresh: true` but reauth also 401 — throws `InvidiousAuthError('invalid')`, marks stale.
   - 429 with `Retry-After` — throws `InvidiousAuthError('rate-limited', retryAfterMs)`.
   - Network error → `InvidiousAuthError('unreachable')`.
2. **`auth.ts` unit tests**:
   - `formAuth('signin')` happy path extracts SID from Set-Cookie.
   - `formAuth('register')` with instance response containing "Registration is disabled" flash throws `InvidiousAuthError('registration-disabled')`.
   - `reauthenticate` with valid stored password succeeds.
   - `reauthenticate` with invalid stored password throws `InvidiousAuthError('invalid')` and marks stale.
3. **Migration test** — ensure `pnpm db:generate` produces a clean migration and `pnpm db:migrate` applies it idempotently against a fresh DB.
4. **Manual smoke against parker's real Invidious instance** (not a unit test — one-shot verification during dev):
   - Link a fresh account, verify stored password works
   - Kill the SID in the DB manually, reload `/videos/subscriptions`, verify silent recovery
   - Corrupt the stored password, reload, verify `StaleCredentialBanner` appears with actionable copy
   - Click reconnect, verify modal prefills username

## Migration notes

- **Schema migration** is strictly additive (three nullable columns). No data migration needed.
- **Existing credentials** continue to work — they just don't have `stored_password`, so they operate in session-only mode until the user re-links. Not a regression.
- **Existing route handlers** that hand-roll the cookie header keep working during development — migrate them one at a time. All 7 must be migrated before the feature ships.
- **No adapter-contract changes** on the public `ServiceAdapter` interface. The new `client.ts` is internal to the Invidious module.

## Out of scope

- **Multi-instance UX** — switching between Invidious instances. The current `services.url` model handles this at the admin level but not smoothly for users. Separate spec.
- **Player-level auth for stream URLs** — the stream proxy routes already use the adapter's cookie; they'll inherit the new helper but no behavioral change.
- **Nav drawer redesign** — the accounts page gets ONE entry in the user-menu dropdown as a minimum-viable discoverability fix. A larger nav reorganization is a separate concern.
- **DeArrow enrichment, watch history perf, playlist management** — all untouched. Working code stays.
- **Jellyfin parity** — Jellyfin already has stored-credential refresh. Not changing it.
- **Bringing back `createUser` as an adapter method** — not needed. Option 1 (inline register toggle in the modal) means the existing `authenticateUser` handles both paths since Invidious's `/login` does.

## Parker decisions (2026-04-14)

1. **Password-storage disclosure copy** — locked in as: *"Nexus encrypts and stores this password locally so your session can refresh automatically when Invidious expires it. Uncheck to require manual reconnect each time."*
2. **`extra_cookies` column** — dropped. YAGNI until a specific instance needs it.
3. **Nav placement** — all three entry points: user-menu dropdown + sidebar + `/settings/` landing page. All route to the same `/settings/accounts`.
