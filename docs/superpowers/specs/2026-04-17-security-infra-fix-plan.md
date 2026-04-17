# Nexus Security & Infrastructure Fix Plan

**Date:** 2026-04-17
**Scope:** Seven security / infrastructure defects surfaced by the Codex adversarial review (Codex Passes 18 & 19). Implementation plan for ProjectOS issues #4–#10.
**Status:** Ready for implementation.
**Related:** `codex-review/01-runtime-and-data-contracts.md`, `codex-review/18-backend-performance-and-security-holes.md`, `codex-review/19-security-and-infrastructure-flaws.md`

## Overview

The Beta readiness spec (`2026-04-14-beta-release-plan.md`) treats the code gaps as closed, but the review shows seven defects that are either active security holes (cross-user data leak, unauthenticated endpoints, plain-text credentials, spoofable rate limits, locked-account bypass) or infrastructure time bombs (unbounded cache, uncapped upload buffering). These must ship before `v0.1.0-beta.1`. This plan ships as a single `chore/security-infra-hardening` branch, with three commits grouped by shared infrastructure: (1) new primitives (`encryptAtRest`, `requireActiveUser`, bounded cache), (2) wiring those into all affected sites, (3) destructive schema migration for credential re-encryption. No legacy compatibility shims — dev-tier data is expendable.

---

## Shared infrastructure introduced

Three new primitives are added up front. Every fix below reuses them.

### `src/lib/server/crypto.ts` (new)

AES-256-GCM envelope helpers:

```
encryptAtRest(plaintext: string): string           // "v1:<iv_b64>:<tag_b64>:<ct_b64>"
decryptAtRest(blob: string | null): string | null  // null → null, unknown version → throws
```

- Key source: `NEXUS_ENCRYPTION_KEY` env var, 32 bytes hex or base64. Reads once, cached in module scope.
- Startup check: `assertEncryptionKey()` called from `hooks.server.ts` boot path; throws with a readable message if missing so dev installs fail loud instead of silently storing plaintext.
- Output format is self-versioned (`v1:…`) to allow key rotation later.

### `src/lib/server/session-guard.ts` (new)

Canonical per-request authorization helper. Replaces the bespoke `if (!locals.user) throw error(401)` scattered across API routes.

```
requireUser(event): AuthUser                       // 401 if no session
requireActiveUser(event): AuthUser                 // 401 if no session; 403 if pending / forcePasswordReset
requireAdmin(event): AuthUser                      // 401 / 403 appropriately
```

`AuthUser` extends today's `locals.user` with `status` and `forcePasswordReset`, so downstream code can still do fine-grained decisions. This requires widening `app.d.ts` `App.Locals.user` — see issue #7.

### `src/lib/server/cache.ts` (rewrite)

Swap the unbounded `new Map()` for a simple LRU + TTL implementation (no new dependency — `better-sqlite3` is the only native we want). Pattern:

- Module-level `store` becomes a bounded LRU (cap: `CACHE_MAX_ENTRIES` env var, default `5000`).
- Each entry keeps its existing `{ data, expires }`; LRU recency = touch on hit.
- Background sweep: `setInterval(..., 60_000).unref()` walks and evicts expired entries so one-off keys (e.g. parameterized calendar queries) don't sit forever. Same `.unref()` pattern as `rate-limit.ts`.
- Keep the existing `withCache`, `withStaleCache`, `invalidate`, `invalidatePrefix`, `invalidateAll` signatures verbatim — callers don't change.

---

## Issue #4 — Cross-user dashboard cache leak

**Files:**
- `src/lib/server/services.ts:117–141` (`getDashboardFast`)
- `src/lib/server/services.ts:280–289` (`aggregateRecentlyAdded`)
- `src/lib/server/services.ts:403` (the other `withStaleCache` on a per-list key — verify it also namespaces by user; it currently does)

**Root cause.** Line 125 keys `withStaleCache` as the literal string `'new-in-library'`. `aggregateRecentlyAdded` receives `userId` and uses it to resolve per-user credentials via `resolveUserCred(config, userId)`, so the resolved items reflect user A's library permissions. The first request populates the cache; every subsequent user gets user A's data back.

**Fix.**
- Change the cache key to `` `new-in-library:${userId ?? 'anon'}` `` on line 125. Mirror the pattern already used on line 123 (`` `cw:${userId}` ``) and line 403.
- Guard rail: a lint-style unit test that imports `getDashboardFast` and asserts two sequential calls with different `userId`s produce distinct cache entries (inspect via a test-only `__debugCacheKeys()` export on `cache.ts`, gated by `NODE_ENV === 'test'`).
- Audit every other `withCache`/`withStaleCache` site for the same class of bug. Known fine sites: `cw:${userId}`, `services.ts:403` (per-config cacheKey). Known needs-review: `src/routes/api/calendar/+server.ts:17` (calendar is public aggregation from Radarr/Sonarr, so per-user keying isn't required after issue #6 makes the route authenticated; leave as-is but document).

**Migration.** None — cache is in-memory.

**Test plan.**
- Vitest: `services.test.ts` — seed two fake library adapters returning disjoint result sets based on `cred`, call `getDashboardFast('user-a')` then `getDashboardFast('user-b')`, assert both return their own data.
- Regression: assert `'new-in-library'` does NOT appear as a key in the store after two users hit the dashboard.

---

## Issue #5 — Plain-text passwords for external services

**Files:**
- `src/lib/db/schema.ts:85` — column `storedPassword: text('stored_password')` (comment falsely says "encrypted")
- `src/lib/server/auth.ts:216–265` — `upsertUserCredential` writes raw value
- `src/lib/adapters/registry-auth.ts:81–90` — `getStoredPassword` reads raw value
- `src/lib/adapters/registry-auth.ts:127–135`, `:276–291` — consumers pass raw value to `adapter.refreshCredential(…, storedPassword)`
- `src/routes/api/user/credentials/+server.ts:254` — write path from credential linker
- `src/lib/server/account-services.ts:88,105` — read path (only used for `hasStoredPassword` boolean; still needs to not leak the ciphertext)
- Adapter consumers of `refreshCredential(config, userCred, storedPassword)`:
  - `src/lib/adapters/jellyfin.ts:695–706`
  - `src/lib/adapters/invidious.ts:343–349`
  - `src/lib/adapters/calibre.ts:128–136`
  - `src/lib/adapters/romm.ts:648–651`

**Root cause.** `upsertUserCredential` inserts `body.password` verbatim. The schema comment lies.

**Fix.**
- In `upsertUserCredential`, wrap writes with `encryptAtRest(cred.storedPassword)` before insert/update. `null` stays `null`; `undefined` still means "leave existing value alone" (preserve current semantics).
- In `getStoredPassword` (`registry-auth.ts`), decrypt before return: `decryptAtRest(row?.storedPassword) ?? null`.
- Adapters (`refreshCredential`) continue to receive the plaintext parameter — no signature changes. The envelope is fully internal to the auth layer.
- `account-services.ts:105` — already only exposes `hasStoredPassword = !!row.storedPassword`. Keep as-is; ciphertext is truthy so boolean remains correct.
- Update the schema comment on line 85: "AES-256-GCM encrypted via encryptAtRest; nullable; raw plaintext never persists."

**Migration strategy (destructive).** Dev-only; per Parker's standing rule we do not preserve legacy rows.

1. New drizzle migration `0005_encrypt_stored_password.sql`: `UPDATE user_service_credentials SET stored_password = NULL;`. This clears every existing password. Users hit the normal stale-credential banner and re-link via the `POST /api/user/credentials/reconnect` path already shipped.
2. No schema change is strictly required — the column type stays `TEXT`. But bump a comment in `schema.ts` and note the break in `CLAUDE.md` so the next fresh checkout knows.
3. `NEXUS_ENCRYPTION_KEY` generated on first dev boot: `assertEncryptionKey()` prints a one-shot `openssl rand -hex 32` suggestion and exits non-zero if the var is missing.

**Test plan.**
- Vitest `crypto.test.ts`: round-trip `encryptAtRest` / `decryptAtRest`, assert ciphertext differs across calls (IV is random), assert unknown version prefix throws.
- Vitest `auth.test.ts`: `upsertUserCredential({ storedPassword: 'hunter2' })` then read raw column via `getDb()`, assert it starts with `'v1:'` and does NOT equal `'hunter2'`. Then call `getStoredPassword` and assert it returns `'hunter2'`.

---

## Issue #6 — Unauthenticated calendar/EPG API

**Files:**
- `src/routes/api/calendar/+server.ts:8–38` — no `locals.user` check
- `src/hooks.server.ts:132–135` — the line `if (path.startsWith('/api')) { return resolve(event); }` on the no-session branch allows all API routes through as unauthenticated

**Root cause.** The `/api/calendar` endpoint skipped the standard endpoint-level `if (!locals.user) throw error(401)` that neighboring routes (e.g. `src/routes/api/live/guide/+server.ts:11`) include. Combined with the hooks deferring to endpoints, anonymous requests reach Radarr/Sonarr release data.

**Fix.**
- At the top of `GET` in `src/routes/api/calendar/+server.ts`, replace the bare handler signature with `async ({ url, locals })` and call `const user = requireActiveUser({ locals });` (from the new session-guard; see shared infra). This gates the endpoint AND subsumes the issue #7 fix.
- Convert the cache key to include the user: `` `calendar:${user.id}:${days}:${typesParam ?? 'all'}` ``. Calendar content is not user-specific today, but credentials that backend services accept may diverge per user — key by user to avoid a future repeat of #4.
- Sweep all `src/routes/api/**/+server.ts` for the same class of omission. Any endpoint not in `NO_AUTH_PATHS` that returns data MUST call `requireUser` or `requireActiveUser`. Known clean sites: `/api/live/guide` already checks. Audit at minimum: `/api/search`, `/api/discover`, `/api/media/**`, `/api/activity/**`, `/api/franchise`, `/api/person`, `/api/trailers` (present in repo? grep before assuming). Every remaining 401-less handler gets one line added.

**Migration.** None.

**Test plan.**
- Vitest: hit the `/api/calendar` endpoint without a session cookie, assert 401.
- Playwright: smoke test that an authenticated session still gets 200 with items.

---

## Issue #7 — Pending/locked accounts bypass auth via API

**Files:**
- `src/hooks.server.ts:88–130` — status check only runs on page branch, not API branch
- `src/lib/db/schema.ts:187` — user status enum (`'active' | 'pending'`)
- `src/lib/db/schema.ts:186` — `forcePasswordReset` boolean
- `src/app.d.ts:6–8` — `App.Locals.user` missing `status` + `forcePasswordReset`

**Root cause.** `hooks.server.ts` populates `locals.user` for any valid session (line 90), then returns early for `/api` paths (line 93) before the `forcePasswordReset` and `status === 'pending'` redirects run. API endpoints only check `if (!locals.user)`, so a pending or password-locked user can still fetch `/api/media/**`, start playback, etc.

**Fix.**
- Widen `App.Locals.user` in `src/app.d.ts` to carry `status: 'active' | 'pending'` and `forcePasswordReset: boolean`.
- In `hooks.server.ts:90`, include both fields when attaching user to locals.
- Introduce `requireActiveUser(event)` (shared infra). It checks `locals.user`, then refuses with `403` if `status === 'pending'` or `forcePasswordReset === true`, with a distinguishing `X-Nexus-Reason` header (`pending-approval` / `password-reset-required`) so the SPA can surface a useful toast.
- Convert every API endpoint that currently does `if (!locals.user) throw error(401, 'Unauthorized')` to `const user = requireActiveUser(event)`. This is a mechanical sweep — grep for `locals.user` in `src/routes/api/**` and replace. A handful of endpoints should legitimately stay on the raw `requireUser` (e.g. `/api/auth/logout`, `/api/auth/reset-password/*`) — flag these by inspection, document the exceptions.
- Keep the page-route redirects exactly as they are (lines 98–109 of `hooks.server.ts`). Those still handle the browser-facing flow.

**Migration.** None — in-place logic change.

**Test plan.**
- Vitest: seed a user with `status='pending'`, issue a request to a representative API route (e.g. `/api/dashboard`) with that user's session cookie, assert 403 and `X-Nexus-Reason: pending-approval`.
- Vitest: same for `forcePasswordReset=true`, assert `X-Nexus-Reason: password-reset-required`.
- Vitest: normal `active` user returns 200 from the same endpoint.

---

## Issue #8 — Global cache has no eviction

**Files:**
- `src/lib/server/cache.ts:11` — module-level `Map` with no bound

**Root cause.** The only paths that delete entries are explicit `invalidate*` calls and the overwrite-on-miss branch. Unique, parameterized keys (e.g. `` `calendar:${userId}:${days}:${typesParam}` ``, `` `cw:${userId}` `` for transient sessions, rec-engine keys) accumulate forever.

**Fix.** See **Shared infrastructure** above — bounded LRU + TTL sweep.

- Cap: `CACHE_MAX_ENTRIES` env (default 5000). When full, evict LRU.
- Background sweep every 60s removes entries with `expires < now - staleGraceMs` where `staleGraceMs` is the largest stale window used by `withStaleCache` callers (`30 * 60_000` = 30 minutes, visible at `services.ts:403`). Pick `staleGraceMs = 30 * 60_000` as a safe ceiling.
- Sweep interval registered with `.unref()` so it never blocks shutdown.
- Export a `__debugCacheStats()` under `NODE_ENV === 'test'` returning `{ size, hits, misses, evictions }` for observability tests.

**Migration.** None — in-memory only.

**Test plan.**
- Vitest `cache.test.ts`: fill cache with `CACHE_MAX_ENTRIES + 100` unique keys, assert `size === CACHE_MAX_ENTRIES` and that the oldest ones are gone.
- Vitest: `vi.useFakeTimers()`, set 10 entries with 1s TTL, advance 120s, tick the sweep, assert all 10 are evicted.

---

## Issue #9 — Rate-limit bypass via X-Forwarded-For spoofing

**Files:**
- `src/lib/server/rate-limit.ts:55–62` — `getClientIp` reads XFF without any trust check
- `src/hooks.server.ts:63` — sole caller passes the request directly

**Root cause.** `getClientIp` returns the first `X-Forwarded-For` token unconditionally. Any client that isn't behind a configured proxy still has this header honored, so `curl -H 'X-Forwarded-For: $RANDOM' …` resets the rate-limit bucket per request.

**Fix.**
- Introduce two env vars:
  - `NEXUS_TRUST_PROXY` — boolean (`'1'` / `'true'`). Off by default. When off, XFF is ignored.
  - `NEXUS_TRUSTED_PROXIES` — comma-separated list of CIDRs. Ignored unless `NEXUS_TRUST_PROXY` is on. Defaults to loopback + RFC1918 (`127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`) when the flag is on but the list is unset.
- Rewrite `getClientIp(event: RequestEvent): string` to take the full `RequestEvent` (not just `Request`). It:
  1. Gets the peer address via `event.getClientAddress()` (SvelteKit provides this through `adapter-node`).
  2. If `NEXUS_TRUST_PROXY` is off → returns the peer address.
  3. Otherwise, if peer address is within `NEXUS_TRUSTED_PROXIES`, walks `X-Forwarded-For` from right-to-left and returns the first address outside the trusted set.
  4. Falls back to the peer address.
- Update `hooks.server.ts:63` to pass `event` instead of `event.request`.
- Add a tiny CIDR-match util in `rate-limit.ts` (IPv4 only is fine for dev — document IPv6 follow-up).
- Update `.env.example` (create if absent) and README with the two new vars.

**Migration.** None — runtime config only. Self-hosters running behind Nginx/Traefik/Caddy set both env vars in their compose file.

**Test plan.**
- Vitest `rate-limit.test.ts`: with `NEXUS_TRUST_PROXY` unset, mock event with spoofed XFF and peer `1.2.3.4`, assert resolved IP is `1.2.3.4` (peer) — so two requests from that peer count against the same bucket regardless of header.
- Vitest: with trust on and peer in 10.0.0.0/8, assert the rightmost-untrusted XFF entry is used.
- Vitest: bucket exhaustion with spoofed XFF still returns 429 (confirms the bypass is closed).

---

## Issue #10 — Subtitle upload has no size cap

**Files:**
- `src/routes/api/subtitles/upload/+server.ts:12–44`

**Root cause.** `request.formData()` fully parses the multipart body; `await file.arrayBuffer()` then doubles the footprint. A malicious upload of a few GB crashes Node with heap OOM.

**Fix.**
- Add a hard size cap via new env var `NEXUS_SUBTITLE_MAX_BYTES` (default `2_000_000` — 2 MB; real subtitle files are tens of KB).
- At the start of the handler, before touching `formData()`:
  1. Gate with `requireActiveUser(event)` (benefits from issue #7).
  2. Read `request.headers.get('content-length')`. If missing or `> NEXUS_SUBTITLE_MAX_BYTES`, throw `error(413, 'Subtitle upload too large')`.
- Keep `formData()` parsing for now (fully streaming multipart in SvelteKit is awkward; the Content-Length gate is sufficient defense-in-depth at dev scale).
- After `const file = formData.get('file') as File | null`, re-check `file.size > NEXUS_SUBTITLE_MAX_BYTES` — belt and suspenders in case Content-Length was absent or wrong.
- Also validate `file.type` is in an allow-list: `['application/x-subrip', 'text/vtt', 'application/octet-stream', '']` (Safari sends empty; Bazarr accepts `.srt`/`.vtt`). Reject with 415 otherwise.
- Do the same size check in `/api/subtitles/download/+server.ts`, `/api/subtitles/sync/+server.ts`, `/api/subtitles/translate/+server.ts` if they accept body payloads — grep before adding (upload is the headline site per Codex).

**Migration.** None.

**Test plan.**
- Vitest: POST a `Content-Length: 99999999` request, assert 413 without the handler reading the body.
- Vitest: POST a valid 20 KB SRT, assert 200 reaches the adapter.
- Vitest: POST a 5 MB buffer with Content-Length deliberately understated, assert the post-parse `file.size` guard trips to 413.

---

## Sequencing

Ship on a single branch `chore/security-infra-hardening`, three commits:

**Commit 1 — Shared infrastructure.**
- `src/lib/server/crypto.ts` (new) + `assertEncryptionKey` wired in `hooks.server.ts` boot block.
- `src/lib/server/session-guard.ts` (new).
- `src/lib/server/cache.ts` (rewrite, same signatures, bounded LRU + sweep).
- `src/app.d.ts` widened.
- Unit tests for all three primitives.
- No behavioural change to existing endpoints yet; existing `locals.user` checks still work.

**Commit 2 — Fix application.**
- Issue #4 (dashboard cache key).
- Issue #6 (calendar auth + api-route audit sweep).
- Issue #7 (swap `locals.user` checks to `requireActiveUser`).
- Issue #9 (rate-limit trusted-proxy handling).
- Issue #10 (subtitle upload cap).
- Issue #8 (cache eviction is already live via commit 1 — this commit wires the stats export into an admin debug endpoint only if time permits; otherwise land in a follow-up).
- Targeted tests for each fix.

**Commit 3 — Credential encryption migration.**
- Issue #5 — drizzle migration `0005_encrypt_stored_password.sql` that nulls all existing `stored_password` rows.
- `upsertUserCredential` / `getStoredPassword` encrypt/decrypt calls.
- Schema comment updated.
- README / CLAUDE.md note about `NEXUS_ENCRYPTION_KEY`.

Commits 1 and 3 touch disjoint file sets and can be parallelized by subagents. Commit 2 depends on commit 1.

---

## Rollout and verification checklist

1. Generate `NEXUS_ENCRYPTION_KEY` (`openssl rand -hex 32`), add to `.env.example` with a note, and the live dev `.env`.
2. Run `pnpm db:generate` to emit the destructive migration, then `pnpm db:migrate` against the dev DB.
3. `pnpm check` — no TypeScript regressions from the `App.Locals.user` widening.
4. `pnpm test` — all new Vitest suites pass.
5. `pnpm test:e2e` — Playwright smoke (may need the pre-seeded admin fixture; note the existing `test:e2e broken since /setup wizard` open thread in `CLAUDE.md`; if fixture is still broken, document and skip — this plan does not fix e2e bootstrapping).
6. Manual smoke in dev:
   - Unauthenticated `curl http://localhost:5173/api/calendar` → 401.
   - Unauthenticated `curl http://localhost:5173/api/subtitles/upload -F file=@/dev/urandom` → 413 (or 401 first, which is fine — defense is layered).
   - Log in as a `pending` test user, hit `/api/dashboard` → 403 with `X-Nexus-Reason: pending-approval`.
   - Log in normal user, hit `/api/dashboard`, log in as different user in private window, hit same endpoint, confirm the two dashboards show distinct `new-in-library` items.
   - Re-link a Jellyfin account; verify `user_service_credentials.stored_password` in the DB file starts with `v1:` and is not the typed password.
   - Issue `curl -H 'X-Forwarded-For: 99.99.99.99'` repeatedly from localhost without `NEXUS_TRUST_PROXY` set; confirm 429 trips at the 300/min cap.
7. Update `project_nexus.md` under the open threads: tick off the seven issues; note any deferrals.
8. `pnpm build` green; commit and push branch; open PR targeting `main` with a link to this spec and to ProjectOS #4–#10.
9. Before tagging `v0.1.0-beta.1`, confirm the Beta release plan's "code gaps closed" claim still holds after these changes — specifically that the fresh-install bootstrap described in that doc still passes with the new encryption-key requirement. If it doesn't, the release plan needs an addendum calling out the new env var.
