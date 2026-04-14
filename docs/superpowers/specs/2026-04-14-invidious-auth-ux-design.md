# Invidious Auth + UX — Design (Consumer of the Adapter Contract)

**Date:** 2026-04-14
**Scope:** Invidious-specific implementation of the umbrella architecture, serving as the first real consumer of the adapter contract + shared registry + shared UI components + auto-linking flow. Fixes the two nightmares that spawned this whole initiative — backend auth rot and UX discoverability — by *consuming* the shared primitives from the other specs rather than defining them.
**Status:** Revised 2026-04-14 after the umbrella, contract, settings UX, auto-link, and plugin-loader specs landed.
**Depends on (all approved in this initiative):**
- [`2026-04-14-service-account-umbrella-design.md`](./2026-04-14-service-account-umbrella-design.md)
- [`2026-04-14-adapter-contract-design.md`](./2026-04-14-adapter-contract-design.md)
- [`2026-04-14-settings-ux-rework-design.md`](./2026-04-14-settings-ux-rework-design.md)
- [`2026-04-14-auto-link-multi-parent-design.md`](./2026-04-14-auto-link-multi-parent-design.md)

**Tracking:** ProjectOS Nexus #2 — *Pluggable adapter architecture*.

## Problem (unchanged from the original)

Two nightmares, one coherent fix.

### Nightmare 1 — Backend auth rot (silent failures)

When an Invidious SID cookie expires, Nexus silently fails across 8 code paths:

1. `invFetch` (`src/lib/adapters/invidious.ts:138-140`) doesn't detect expired SIDs — a 401 just throws `Invidious /api/v1/auth/foo -> 401` with no kind discrimination.
2. No stored password, so no auto-refresh. When the SID dies, the user must manually unlink + relink.
3. Every adapter read method swallows 401 into `[]`. `getContinueWatching`, `getLibrary`, `getCalendar`, and `search` all `try { ... } catch { return []; }`.
4. SID-cookie handling is hand-rolled in 7 different route files. No shared helper.
5. Accounts page has no health probe. `✓ Linked as parker` even when the SID is dead.
6. `authenticateUser` always re-logs in, no attempt to test the existing SID. Public instances rate-limit `/login`.
7. Single-cookie extraction via `/SID=([^;]+)/`. Fragile if the instance sends multiple cookies.
8. `getWatchHistory` returns bare video ID strings, leading to N+1 round trips where one 401 filters out silently.

### Nightmare 2 — UX discoverability ("I don't know how to log in")

Traced through the code:

1. `/videos/+page.svelte:445-494` gates the subscription feed on `data.hasLinkedAccount && data.hasInvidious` — when false, section doesn't render. No CTA.
2. `/videos/subscriptions/+page.svelte:67` is a dead-end text: *"Link your account in settings to see subscriptions."*
3. `/settings/accounts` is only reachable by typing the URL.
4. The link modal uses generic copy with no instance-URL display, no register toggle, no password-storage disclosure.
5. `authenticateUser` error messages are opaque (*"Invidious auth failed (status 200) — check credentials"*).
6. `createUser` was correctly removed in commit `e347328` — but now there's no account-creation story for Invidious at all.

## Resolution — how the umbrella stack fixes each

Every problem above maps to infrastructure defined in the other specs. This table is the whole story:

| Problem | Solved by |
|---|---|
| #1 `invFetch` no 401 detection | Adapter contract's `AdapterAuthError` + shared registry's auto-refresh — Invidious implementation just needs to throw the right kind |
| #2 No stored password | Umbrella's `stored_password` column + contract's `refreshCredential` method — Invidious implements `refreshCredential(config, userCred, storedPassword)` |
| #3 Read methods swallow 401 | Contract's read-method error propagation rule — Invidious removes every `catch { return []; }` and lets `AdapterAuthError` propagate |
| #4 Scattered cookie header | New module structure under `src/lib/adapters/invidious/` with a single `invidiousFetch` helper all 7 route files use |
| #5 No health probe | Contract's `probeCredential` method + shared registry's health-probe machinery — Invidious implements a cheap probe via `GET /api/v1/auth/preferences` |
| #6 Re-login every time | Shared registry handles refresh; Invidious just provides `formAuth` for the initial login and `refreshCredential` for re-login |
| #7 Single-cookie extraction | Invidious `auth.ts` captures `SID` robustly; `extra_cookies` column dropped per YAGNI |
| #8 N+1 round trips in `getWatchHistory` | Not auth-related; deferred to a follow-up perf pass. Only called out here so we don't pretend it's fixed. |
| `/videos` no CTA | Settings UX spec's `SignInCard.svelte` — Invidious `/videos/*` pages import and render it when unlinked |
| Dead-end subscriptions text | Same — replaced with `SignInCard` hero variant |
| `/settings/accounts` unreachable | Settings UX spec's three-point nav (user menu + sidebar + settings landing) |
| Link modal generic | Settings UX spec's `AccountLinkModal.svelte` — service-agnostic, consumes Invidious's `capabilities` object |
| Opaque errors | Contract's `AdapterAuthError.kind` taxonomy + settings UX spec's `errorCopy.ts` — Invidious maps its flash-text responses to the right kinds |
| No account creation | Register toggle in `AccountLinkModal` — Invidious sets `supportsRegistration: true` since its `/login` auto-registers unknown users with `action=signin` |

**The Invidious spec's job is minimal:** implement the adapter against the shared infrastructure, provide the Invidious-specific flash-text mapping, wire the shared components into the 4 video pages. Everything else comes for free.

## Invidious-specific implementation

### Module layout

```
src/lib/adapters/invidious.ts                 # thin adapter shim (default export)
src/lib/adapters/invidious/
  client.ts                                   # invidiousFetch — the single auth+fetch helper
  auth.ts                                     # formAuth (mode: signin | register), reauth, flash mapping
  normalize.ts                                # moved verbatim from current file (unchanged)
  helpers.ts                                  # subscription/playlist/history/comments (unchanged)
  types.ts                                    # InvidiousVideo + adapter-internal types
  __tests__/
    client.test.ts                            # fetch-mock driven retry + stale tests
    auth.test.ts                              # flash-text mapping + formAuth modes
```

Same shape as the Calibre rewrite (`2026-04-13-calibre-adapter-rewrite-design.md`). Working code moves verbatim; only the auth layer gets rewritten.

### `client.ts` — Invidious fetch helper

**Consumes** the shared registry's auto-refresh machinery. Its own job is just to:

1. Apply the `Cookie: SID=<accessToken>` header when a user credential is present.
2. Parse responses.
3. Throw the right `AdapterAuthError.kind` when things go wrong.

```ts
import { AdapterAuthError } from '@nexus/adapter-sdk';

export async function invidiousFetch<T = unknown>(
  config: ServiceConfig,
  path: string,
  userCred?: UserCredential,
  init?: RequestInit
): Promise<T> {
  // Always apply SID cookie if we have one
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (userCred?.accessToken) {
    headers['Cookie'] = `SID=${userCred.accessToken}`;
  }

  let res: Response;
  try {
    res = await fetch(`${config.url}${path}`, {
      ...init,
      headers,
      signal: init?.signal ?? AbortSignal.timeout(8000)
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new AdapterAuthError(
        `Invidious at ${config.url} is unreachable`,
        'unreachable'
      );
    }
    throw err;
  }

  // Auth-scoped endpoints — 401 means SID is dead
  if (res.status === 401 && path.startsWith('/api/v1/auth/')) {
    throw new AdapterAuthError('Invidious session expired', 'expired');
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '0', 10);
    throw new AdapterAuthError(
      'Invidious is rate-limiting requests',
      'rate-limited',
      retryAfter * 1000 || undefined
    );
  }

  if (!res.ok) {
    throw new Error(`Invidious ${path} -> ${res.status}`);
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}
```

**No retry logic here.** When `invidiousFetch` throws `AdapterAuthError('expired')`, the shared registry layer (`src/lib/adapters/registry/auth-refresh.ts` per the contract spec) catches it, calls `refreshCredential`, updates the DB, and retries the original call. The fetch helper stays dumb.

### `auth.ts` — form auth + flash-text mapping

```ts
import { AdapterAuthError } from '@nexus/adapter-sdk';

export type FormAuthMode = 'signin' | 'register';

/**
 * Perform form-based authentication against Invidious's /login endpoint.
 * Invidious uses a single endpoint for both signin and register when
 * registration is enabled. The mode parameter controls which flash text
 * the caller expects in the response.
 */
export async function formAuth(
  config: ServiceConfig,
  username: string,
  password: string,
  mode: FormAuthMode
): Promise<string> {
  const body = new URLSearchParams({
    email: username,
    password: password,
    action: 'signin'  // always 'signin'; register is implicit when user doesn't exist
  });

  let res: Response;
  try {
    res = await fetch(`${config.url}/login?type=invidious&referer=%2F`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(8000)
    });
  } catch (err) {
    throw new AdapterAuthError('Cannot reach Invidious', 'unreachable');
  }

  // Success = 302 with Set-Cookie SID=...
  if (res.status === 302) {
    const setCookie = res.headers.get('set-cookie') ?? '';
    const match = setCookie.match(/SID=([^;]+)/);
    if (!match) {
      throw new AdapterAuthError(
        'Invidious login succeeded but returned no SID cookie',
        'invalid'
      );
    }
    return match[1];
  }

  // Non-302 = failure. Invidious returns 200 with HTML containing a flash
  // message. Map known flash text to AdapterAuthError kinds.
  if (res.status === 200) {
    const html = await res.text();
    if (/captcha/i.test(html)) {
      throw new AdapterAuthError(
        'Invidious requires CAPTCHA — sign in on the instance directly first',
        'rate-limited'
      );
    }
    if (/registration.*disabled/i.test(html) || /registrations? (?:are )?closed/i.test(html)) {
      if (mode === 'register') {
        throw new AdapterAuthError(
          'This Invidious instance does not allow new accounts',
          'registration-disabled'
        );
      }
      // In signin mode, registration-disabled flash with wrong-password is
      // indistinguishable from normal wrong-password. Treat as invalid.
      throw new AdapterAuthError('Invalid Invidious credentials', 'invalid');
    }
    if (/wrong username or password/i.test(html) || /invalid/i.test(html)) {
      throw new AdapterAuthError('Invalid Invidious credentials', 'invalid');
    }
    // Unknown flash — likely still a bad password, but mention we couldn't parse it
    throw new AdapterAuthError(
      'Invidious login failed (unrecognized response)',
      'invalid'
    );
  }

  if (res.status >= 500) {
    throw new AdapterAuthError(
      `Invidious server error (${res.status})`,
      'unreachable'
    );
  }

  throw new AdapterAuthError(
    `Unexpected Invidious response (${res.status})`,
    'invalid'
  );
}

/**
 * Refresh credential using stored password. Matches the shared contract
 * signature; called by the shared registry's auto-refresh machinery.
 */
export async function refreshCredential(
  config: ServiceConfig,
  userCred: UserCredential,
  storedPassword: string
): Promise<UserCredentialResult> {
  const username = userCred.externalUsername;
  if (!username) {
    throw new AdapterAuthError(
      'Cannot refresh: missing external username',
      'invalid'
    );
  }
  const newSid = await formAuth(config, username, storedPassword, 'signin');
  return {
    accessToken: newSid,
    externalUserId: username,
    externalUsername: username
  };
}
```

### `probeCredential` implementation

```ts
export async function probeCredential(
  config: ServiceConfig,
  userCred: UserCredential
): Promise<'ok' | 'expired' | 'invalid'> {
  try {
    await invidiousFetch(config, '/api/v1/auth/preferences', userCred);
    return 'ok';
  } catch (err) {
    if (err instanceof AdapterAuthError) {
      if (err.kind === 'expired') return 'expired';
      if (err.kind === 'invalid') return 'invalid';
    }
    // Network errors etc. — assume expired so the UI prompts reconnection
    return 'expired';
  }
}
```

`/api/v1/auth/preferences` is a cheap authenticated endpoint that returns JSON for the user's preferences. Single round-trip, no side effects. If it works, the credential is healthy.

### Adapter declaration — capabilities

```ts
// src/lib/adapters/invidious.ts
import { declareAdapter } from '@nexus/adapter-sdk';
import * as impl from './invidious/impl';

export default declareAdapter({
  id: 'invidious',
  displayName: 'Invidious',
  defaultPort: 3000,
  color: '#f44336',
  abbreviation: 'IV',
  icon: 'invidious',
  contractVersion: 1,
  tier: 'user-standalone',

  capabilities: {
    media: ['video'],

    // No admin credential needed — Invidious instances don't have a management
    // surface we consume. Trending/popular are fetched unauthenticated.
    // adminAuth is absent entirely.

    userAuth: {
      userLinkable: true,
      usernameLabel: 'Username or email',
      supportsRegistration: true,       // /login auto-registers unknown users
      supportsAccountCreation: false,   // but there's no separate createUser — /login does double duty
      supportsPasswordStorage: true,    // enables auto-refresh via stored_password
      supportsHealthProbe: true
    },

    library: true,
    search: { priority: 0 },
    calendar: true
  },

  // Required methods
  ping: impl.ping,

  // User auth methods
  authenticateUser: impl.authenticateUser,
  probeCredential: impl.probeCredential,
  refreshCredential: impl.refreshCredential,
  getImageHeaders: impl.getImageHeaders,

  // Library methods
  getLibrary: impl.getLibrary,
  getRecentlyAdded: impl.getRecentlyAdded,
  getContinueWatching: impl.getContinueWatching,

  // Other existing methods (unchanged)
  search: impl.search,
  getTrending: impl.getTrending,
  getItem: impl.getItem,
  getCalendar: impl.getCalendar,
  setItemStatus: impl.setItemStatus,
  manageCollection: impl.manageCollection,
  manageSubscription: impl.manageSubscription,
  enrichItem: impl.enrichItem
});
```

**Note on the `Username or email` label:** current Invidious accepts either in the email field of `/login`. Document it as such in the UI so users aren't confused about which to type.

### Read-method error propagation — the breaking change

Every read method currently wraps in `try { ... } catch { return []; }`. These wrappers get removed. The new pattern:

```ts
async getContinueWatching(config, userCred): Promise<UnifiedMedia[]> {
  if (!userCred?.accessToken) return [];

  // No try/catch — let AdapterAuthError propagate to the shared registry
  const videoIds = await invidiousFetch<string[]>(
    config,
    '/api/v1/auth/history?page=1',
    userCred
  );
  if (!videoIds || videoIds.length === 0) return [];

  const ids = videoIds.slice(0, 10);
  const results = await Promise.allSettled(
    ids.map(id => invidiousFetch<InvidiousVideo>(
      config,
      `/api/v1/videos/${encodeURIComponent(id)}`,
      userCred
    ))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<InvidiousVideo> => r.status === 'fulfilled')
    .map(r => {
      const item = normalizeVideo(config, r.value);
      item.progress = 0.05;
      return item;
    });
}
```

If `invidiousFetch` throws `AdapterAuthError('expired')`, the shared registry's auto-refresh catches it, tries `refreshCredential`, retries the call. If the refresh also fails, the error propagates up to the page server load, which catches it as part of its standard error handling and returns `{ items: [], error: { kind: 'auth_expired' } }` to the client. The consumer page sees `error: 'auth_expired'` and renders the `StaleCredentialBanner`.

**Non-auth errors** still propagate as plain `Error` and are caught at the same layer — they just don't trigger the stale-banner flow.

### Route-file migration

The 7 hand-rolled `Cookie: SID=...` blocks:

- `src/routes/api/video/stream/[videoId]/+server.ts:120`
- `src/routes/api/video/stream/[videoId]/formats/+server.ts:23`
- `src/routes/api/video/stream/[videoId]/dash/+server.ts:25`
- `src/routes/api/video/stream/[videoId]/captions/+server.ts:27`
- `src/routes/api/video/search/+server.ts:49`
- `src/routes/videos/playlists/[id]/+page.server.ts:18`
- `src/lib/adapters/invidious.ts:129` (inside `invFetch`)

All replaced with calls to `invidiousFetch`. The stream-proxy routes pass `init` through so they can forward response bodies as-is. Migration is mechanical.

### Consumer page updates

Per the settings UX spec's *Consumer-page integration* section, these pages get the inline components wired in:

- `/videos` (hero variant of `SignInCard` when `!hasLinkedAccount`, `StaleCredentialBanner` when stale)
- `/videos/subscriptions`, `/videos/history`, `/videos/playlists` (inline variant of `SignInCard`, same `StaleCredentialBanner`)

Page server loads already know whether Invidious is linked; they get a new `invidiousServiceSummary: AccountServiceSummary` field in their returned data, computed via `buildAccountServiceSummary` from the settings UX spec's shared helper.

### The register-mode edge case

Invidious's `/login` with `action=signin` auto-registers unknown users when the instance has `registration_enabled: true`. This is unusual — most services have distinct register and signin endpoints.

**For Nexus's UI purposes**, the `AccountLinkModal` still exposes a register toggle when `supportsRegistration: true`. In register mode, the modal:

1. Shows a confirm-password field
2. Adds *"Creates a new account on `<instance>`. You'll own this account — Nexus just uses it to fetch your subscriptions and history."*
3. Submits via `formAuth(username, password, 'register')`

The `formAuth` register mode does the same HTTP call as signin mode, but scans for the `registration-disabled` flash text specifically and throws `AdapterAuthError('registration-disabled')` if seen. Signin mode maps the same flash to `invalid` (since from the user's perspective, trying to sign in to an account that doesn't exist is indistinguishable from wrong-password on a disabled-registration instance).

The `createUser` adapter method is NOT added back. Invidious uses the unified `/login` endpoint and doesn't need a distinct createUser — the register toggle in the modal routes through `authenticateUser` with `mode: 'register'` (a new optional parameter the modal passes through).

## Testing

1. **`client.test.ts`** (vitest + fetch-mock):
   - Happy path — authed GET with SID returns parsed JSON
   - 401 on `/api/v1/auth/*` → throws `AdapterAuthError('expired')`
   - 429 with `Retry-After` → throws `AdapterAuthError('rate-limited', retryAfterMs)`
   - Network error / timeout → throws `AdapterAuthError('unreachable')`
   - 204 empty → returns `undefined`
   - Non-auth 4xx/5xx → throws plain `Error`
2. **`auth.test.ts`**:
   - `formAuth('signin')` happy path extracts SID
   - `formAuth('signin')` with 200 + wrong-password flash → `AdapterAuthError('invalid')`
   - `formAuth('signin')` with 200 + registration-disabled flash → `AdapterAuthError('invalid')` (mode matters)
   - `formAuth('register')` with registration-disabled flash → `AdapterAuthError('registration-disabled')`
   - `formAuth` with 500 → `AdapterAuthError('unreachable')`
   - `formAuth` with captcha flash → `AdapterAuthError('rate-limited')`
   - `refreshCredential` happy path
   - `refreshCredential` with expired stored password → throws `AdapterAuthError('invalid')`
3. **`probeCredential` tests**:
   - Valid credential → `'ok'`
   - Expired credential → `'expired'`
   - Invalid credential → `'invalid'`
4. **Integration test** (manual, one-shot during implementation):
   - Link against a real Invidious instance (Parker's own or a public one)
   - Force-expire the SID in the DB, reload `/videos/subscriptions`, verify silent auto-reconnect
   - Corrupt the stored password, verify `StaleCredentialBanner` appears with actionable copy
   - Click reconnect, verify modal prefills username
   - Try creating a new account (in register mode) against an instance with registration enabled, verify success
   - Try creating against an instance with registration disabled, verify the specific error message
5. **E2E smoke** (playwright):
   - Nexus user visits `/videos/subscriptions` while unlinked → sees `SignInCard`
   - Clicks Connect, types credentials, sees subscription feed

## Migration — order of implementation

Invidious is the **last** thing implemented in the initiative. Order:

1. Schema migration (umbrella)
2. Adapter contract types + shared registry layer
3. Shared UI components (`AccountLinkModal`, `SignInCard`, `StaleCredentialBanner`)
4. Auto-linking orchestration
5. In-tree adapter migration (every adapter moves onto the new contract)
6. Plugin loader (can run in parallel)
7. **Invidious consumer** — this spec. Validates the whole stack works end-to-end.
8. Follow-up resilience passes for Jellyfin, Kavita, Plex, RomM, Overseerr, Streamystats (per ProjectOS Nexus #2 comment)

At step 7, if the Invidious implementation reveals any gaps in the shared layer, go back and patch them — then continue.

## Parker decisions baked in

- **Stored password with disclosure** — checkbox defaults on, copy is the "technical + explicit" variant from the umbrella
- **Register toggle in the modal** — single modal, inline toggle, no separate "Create account" button per service
- **Destructive migration** — the adapter rewrite drops `invFetch` entirely and replaces it with `invidiousFetch`; no backward-compat wrapping
- **Scoped to Invidious** — this spec does NOT redefine the shared components, schema, error taxonomy, or contract. It consumes them.

## Out of scope

- **Getting a real Invidious test instance running for CI.** The integration test is manual against Parker's instance.
- **Fixing `getWatchHistory`'s N+1 pattern.** Perf concern, separate pass.
- **Migrating other user-level adapters** (Jellyfin, Calibre, Kavita, Plex, RomM, Overseerr, Streamystats) — deliverable #6 of ProjectOS Nexus #2.
- **Multi-instance Invidious** (switching between instances seamlessly).
- **Watch parties / SyncPlay / dearrow revisions.**
