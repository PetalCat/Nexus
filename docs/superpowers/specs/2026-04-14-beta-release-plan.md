# Nexus Beta Release Plan — v0.1.0-beta.1

**Date:** 2026-04-14
**Version:** `0.1.0-beta.1` (already in package.json)
**Status:** Blocked on one UX pass + one tag push.

## TL;DR — what's actually needed

Three categories of work separate where we are now from pushing Beta:

1. **One remaining commit** — wire the just-built account-linking UI into the `/setup` wizard so admins get the new experience. (2-4 hours)
2. **One tag push** — `git tag v0.1.0-beta.1 && git push --tags` triggers CI → GHCR image builds → #55 fixed for every future Beta user. (5 minutes)
3. **Release notes + known-limitations doc** — honest statement of what works and what doesn't. (30 minutes)

Everything else is either already done or deliberately deferred to post-Beta.

## What's already done (this session's work)

- **Schema + migrations:** destructive migration applied, fresh installs bootstrap correctly via the new Drizzle migrator (commit `6200f39` — **the real Beta blocker**). Every install now gets the new columns for stored password, stale tracking, parent service FK, auto-link flag.
- **All 13 in-tree adapters migrated** to the `NexusAdapter` contract with `capabilities`, `probeAdminCredential`, `probeCredential`, `refreshCredential`, `findAutoLinkMatch` where applicable.
- **Shared registry auth layer:** `runWithAutoRefresh`, `probeUserCredential`, `reconnectCredential`, plus `POST /api/user/credentials/reconnect`.
- **Shared UI components:** `AccountLinkModal.svelte`, `SignInCard.svelte`, `StaleCredentialBanner.svelte`, `errorCopy.ts`.
- **All 4 `/videos/*` pages** render `SignInCard` when unlinked, `StaleCredentialBanner` when stale, wrap adapter calls in `runWithAutoRefresh`. Verified end-to-end against a mock Invidious — both success and failure refresh paths confirmed.
- **`/settings/accounts`** now uses the shared `AccountLinkModal` for the link flow, renders stale banners at the top, surfaces credentials with the new normalized shape.
- **`POST /api/user/credentials`** accepts `mode: 'signin' | 'register'` and `storePassword: true` and returns structured `{ kind }` errors.
- **Invidious adapter** has a proper `invidiousFetch` helper in `src/lib/adapters/invidious/client.ts` throwing typed `AdapterAuthError` for 401/403/429/network. `formAuth` throws structured errors with specific `kind` values. `/videos/subscriptions` wired to the shared auto-refresh.
- **Bonus fix:** `recommendation_cache` unique index added to silence the `ON CONFLICT` spam in logs.
- **Dev server runs clean** with the updated codebase. Fresh DB bootstrap verified by running `DATABASE_URL=/tmp/nexus-beta-test/nexus.db node build/index.js` from scratch — boots, redirects `/` → `/setup`, schema has every expected column.

## What's blocking Beta

### Blocker 1: `/setup` wizard doesn't use the new account-linking components (#57)

The admin first-run wizard at `src/routes/setup/+page.svelte` still uses the old inline sign-in forms per-service. This is the last "clunky to know what's going on" piece of issue #57. Users never actually see the new `AccountLinkModal` or register toggle or password-storage checkbox during setup unless they come back to `/settings/accounts` later.

**Fix scope:** Rewrite the "connect services" step of the setup wizard to iterate registered services and launch `AccountLinkModal` for each user-linkable one. Reuses everything already built — it's just wiring.

**Effort:** 2-4 hours of focused Svelte work. No new components needed.

### Blocker 2: No GHCR image published (#55)

The Dockerfile builds cleanly. `.github/workflows/release.yml` is ready and triggers on `v*` tags. Parker just hasn't tagged yet, so no image exists for Beta users to pull. Every comment on #55 boils down to "when the tag gets pushed, you can docker run it."

**Fix:** 
```bash
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

CI does the rest — linux/amd64 + linux/arm64 images pushed to `ghcr.io/PetalCat/Nexus:latest` and `:v0.1.0-beta.1`, plus a GitHub Release with auto-generated notes.

### Blocker 3: Release notes documenting known limitations

Beta users need to know what's NOT working so they don't file dup issues. Draft in the Release Notes section below — 10 minutes of writing plus a first pass by Parker.

## Not blocking — explicitly deferred

- **Issue #56 — Live TV plays as download** — Parker already marked post-Beta in the issue body. Needs Jellyfin LiveTv API work (`/LiveTv/Programs` + HLS master playlist). Non-trivial. Target post-Beta.
- **Issue #47 — Subtitle intelligence** — currently on Beta milestone but it's a whole new AI feature. Should move off.
- **Issue #27 — Seerr adapter** — overlaps with existing Overseerr adapter (`seerr` is already aliased to it in the registry). Should move off.
- **The 14 feature/adapter requests (#25, #28-#39, #44, #45, #49, #50, #51, #53, #54)** — all valid future work, none are Beta blockers.
- **Settings landing page, `/welcome` route, `/admin/*` subtree reorganization** — designed in the umbrella spec but deferred. Existing `/settings/accounts` works; it's not pretty but it's functional.
- **6 Invidious stream-proxy route handlers** still hand-roll the SID cookie. They work, just don't use the centralized helper. Post-Beta cleanup.
- **Jellyfin/Calibre/Kavita/Plex/RomM `authenticateUser` throwing plain Error** — still works, just doesn't get structured error kinds in the UI. Users see a generic "Something went wrong" message instead of specific copy. Graceful degradation, not broken.

## Release checklist

```
[ ] 1. Wire AccountLinkModal into /setup wizard's service-linking step
[ ] 2. Rerun smoke test: docs/SMOKE-TEST.md, clean install
[ ] 3. Update docs/SMOKE-TEST.md to cover the new auto-refresh + stale banner flows
[ ] 4. Write release notes (see template below)
[ ] 5. Update CHANGELOG.md if one exists (or create it)
[ ] 6. Close/move Beta milestone issues:
       [ ] #57 → closed by the /setup wiring
       [ ] #55 → closed by the tag push
       [ ] #27 → move to post-beta milestone
       [ ] #47 → move to post-beta milestone
       [ ] #56 → add post-beta label
[ ] 7. Tag and push: git tag v0.1.0-beta.1 && git push origin v0.1.0-beta.1
[ ] 8. Wait for CI green, verify GHCR image exists at ghcr.io/PetalCat/Nexus:v0.1.0-beta.1
[ ] 9. Verify pull + run of the GHCR image on a fresh machine
       (or: docker run --rm -p 8585:8585 -v /tmp/nxbeta:/app/data ghcr.io/petalcat/nexus:v0.1.0-beta.1)
[ ] 10. GitHub Release is auto-created by release.yml — edit to add release notes
[ ] 11. Announce (Reddit post #54 is a separate thread)
```

## Acceptance criteria

Beta is ready to announce when ALL of these are true on a **fresh Docker install**:

1. ✅ `docker run ghcr.io/PetalCat/Nexus:v0.1.0-beta.1` starts and boots to `/setup`
2. ✅ Admin completes first-run setup wizard without errors
3. ✅ Admin adds at least 3 services (Jellyfin + Radarr + Sonarr as the canonical trio) and all three show healthy
4. ✅ Admin links their personal Jellyfin user credential, subscription feed loads
5. ✅ Going to `/videos` without an Invidious credential shows the `SignInCard`, not a blank page
6. ✅ Clicking Connect on the `SignInCard` opens `AccountLinkModal` in place, login works
7. ✅ Opting into "Save password for auto-reconnect" writes `stored_password`; killing the SID in the DB and reloading shows the silent refresh path working
8. ✅ `pnpm check` passes with 0 errors on the tagged commit
9. ✅ `pnpm test` passes with 0 failures on the tagged commit
10. ✅ Every major route returns 200 or an expected redirect (25 routes verified this session)

## Release notes template

```markdown
# Nexus v0.1.0-beta.1 — Open Beta

Nexus is a unified self-hosted media frontend that sits on top of Jellyfin,
Plex, Radarr, Sonarr, Overseerr, Calibre-Web, Invidious, RomM, and more.
One UI, your whole homelab media stack.

## What's in Beta 1

- 13 service adapters: Jellyfin, Plex, Radarr, Sonarr, Lidarr, Overseerr,
  Prowlarr, Bazarr, Calibre-Web, Kavita, Invidious, RomM, Streamystats
- Unified library, search, continue watching, calendar, recommendations
- Per-user account linking with stored-password auto-refresh
- Inline sign-in affordances on every consumer page — never hunt for settings
- Admin dashboard with service health probes
- Book reader (EPUB via foliate-js, PDF via PDF.js)
- Video streaming via Invidious with DeArrow integration
- Request management through Overseerr
- ML recommendations via Streamystats (requires Jellyfin parent)
- Per-service watch parties (SyncPlay — alpha)

## Known limitations — please don't file issues for these

- **Live TV**: Jellyfin LiveTv channels currently download instead of playing.
  Needs Jellyfin LiveTv API rework. Tracked as #56.
- **Mobile app**: none yet. Web works on mobile browsers. Tracked as #51.
- **Some services don't return structured auth errors** — if you see
  "Something went wrong with [service]" instead of a specific message, the
  adapter is using the legacy error shape. Functional, just less pretty.
- **Settings reorganization**: there's no `/welcome` flow for non-admin users
  yet. New users after the admin should navigate to Settings → Accounts to
  link their personal services.

## How to run

    docker run -d \
      --name nexus \
      -p 8585:8585 \
      -v nexus-data:/app/data \
      ghcr.io/petalcat/nexus:v0.1.0-beta.1

Then visit http://localhost:8585 and follow the setup wizard.

## Feedback

Open an issue at https://github.com/PetalCat/Nexus/issues. Please include
the Nexus version, Docker tag, and any relevant logs.

Thank you for testing!
```

## Post-Beta priority list

Roughly in order of value:

1. **Settings UX rework** — the umbrella design from the adapter contract initiative. `/settings/` landing, `/admin/*` subtree, `/welcome` first-run for non-admin users, per-credential granular controls.
2. **Live TV fix (#56)** — biggest user-visible feature gap.
3. **Per-adapter resilience passes** — Jellyfin migrate ad-hoc refresh to shared, the other 5 user-standalone adapters throw `AdapterAuthError`.
4. **Plugin loader** — make external `@nexus-adapter/*` packages loadable so the 13 pending adapter requests can ship as community plugins instead of core PRs.
5. **Feature issues** — subtitle intelligence, parental controls, watch parties, AI curator, Nexus Wrapped, unified calendar.

## Open questions

1. **Is Parker ready to commit to the `/setup` wizard rewrite** being in Beta 1, or do they want to ship Beta 1 without the new onboarding UX and iterate in Beta 2?
2. **Release cadence** — is v0.1.0-beta.1 followed by v0.1.0-beta.2 on every fix, or are we aiming for v0.1.0 stable within a set timeframe?
3. **Marketing prep** — is the Reddit post (#54) part of Beta 1 launch or follow-up?
