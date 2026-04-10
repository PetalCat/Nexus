# Nexus Roadmap

Single source of truth for everything planned, in progress, and completed.
Updated as work progresses. Each item links to its GitHub issue and/or spec/plan.

---

## How to Read This

- **Status:** `done` | `in-progress` | `planned` | `future`
- **Issues** link to GitHub for discussion and tracking
- **Specs** link to design documents with full technical detail
- **Plans** link to implementation plans with task-by-task steps
- Items within each milestone are listed in execution order
- Dependencies are noted where they exist

---

## Milestone 0: Foundation (DONE)

Everything needed to run Nexus as a functional media platform.

| Status | Item | Issue | Spec/Plan |
|--------|------|-------|-----------|
| done | Core adapters (Jellyfin, Radarr, Sonarr, Lidarr, Overseerr, Prowlarr, Bazarr) | — | — |
| done | Per-user auth with service account linking | — | — |
| done | Homepage with personalized recommendations | — | [spec](docs/superpowers/specs/2026-03-11-personalized-homepage-design.md) |
| done | Media detail pages with cast, similar, seasons | — | — |
| done | Search across all services | — | — |
| done | Request management (Overseerr) | — | [spec](docs/superpowers/specs/2026-03-12-requests-page-fixes-design.md) |
| done | Analytics engine + stats | — | [spec](docs/superpowers/specs/2026-03-13-tracking-system-rebuild-design.md) |
| done | Admin dashboard (sessions, health, requests) | — | — |
| done | Invidious adapter (privacy video) | — | — |
| done | Calibre-Web adapter (books) | — | — |
| done | RomM adapter (retro games + EmulatorJS) | — | — |
| done | StreamyStats adapter (ML recommendations) | — | — |
| done | Bazarr adapter (subtitle enrichment) | — | — |

## Milestone 1: Polish & Beta (DONE)

| Status | Item | Issue | Spec/Plan |
|--------|------|-------|-----------|
| done | Docker packaging + CI/CD | — | [plan](docs/superpowers/plans/2026-03-26-open-beta-readiness.md) |
| done | Health endpoint, rate limiting, graceful shutdown | — | [plan](docs/superpowers/plans/2026-03-26-open-beta-readiness.md) |
| done | Books UI redesign (PDF.js + foliate-js readers) | — | [plan](docs/superpowers/plans/2026-03-26-books-ui-redesign.md) |
| done | Hero trailers (auto-play muted, card hover preview) | — | [plan](docs/superpowers/plans/2026-03-27-hero-trailers.md) |
| done | Music refresh (real audio, MusicPill, 9 routes, Now Playing) | — | [plan](docs/superpowers/plans/2026-03-27-music-refresh.md) |
| done | CONTRIBUTING.md with adapter development guide | — | — |

## Milestone 2: Adapter Architecture (DONE)

Make Nexus truly adapter-agnostic so contributors can add services with zero server code changes.

| Status | Item | Issue | Spec/Plan |
|--------|------|-------|-----------|
| done | Capability metadata on ServiceAdapter (isLibrary, isSearchable, etc.) | — | [spec](docs/superpowers/specs/2026-03-28-adapter-consolidation-design.md) |
| done | Session polling moved into adapters (pollSessions) | — | [plan](docs/superpowers/plans/2026-03-28-adapter-consolidation.md) |
| done | Media sync moved into adapters (syncLibraryItems) | — | [plan](docs/superpowers/plans/2026-03-28-adapter-consolidation.md) |
| done | Image proxy auth moved into adapters (getImageHeaders) | — | [plan](docs/superpowers/plans/2026-03-28-adapter-consolidation.md) |
| done | Domain routes use mediaTypes filtering (53 files) | — | [plan](docs/superpowers/plans/2026-03-28-adapter-consolidation.md) |
| done | Server files use registry instead of direct imports | — | [plan](docs/superpowers/plans/2026-03-28-adapter-consolidation.md) |
| done | Self-describing adapter metadata (color, abbreviation) | — | — |
| done | Route-level interface migration (Invidious, RomM, Calibre, Jellyfin) | — | [plan](docs/superpowers/plans/2026-03-29-adapter-interface-migration.md) |

## Milestone 3: *arr API Deep Integration (DONE)

Leverage the full power of every connected service.

### Phase 1: Calendar, Quality, Downloads (DONE)

| Status | Item | Issue | Spec/Plan |
|--------|------|-------|-----------|
| done | getCalendar on Radarr/Sonarr/Lidarr | — | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |
| done | Calendar API route + homepage row | — | [plan](docs/superpowers/plans/2026-03-29-arr-phase1-calendar-quality-queue.md) |
| done | Quality enrichment (4K/HDR/Atmos badges) | — | [plan](docs/superpowers/plans/2026-03-29-arr-phase1-calendar-quality-queue.md) |
| done | QualityBadge component (icon style) | — | [plan](docs/superpowers/plans/2026-03-29-arr-phase1-calendar-quality-queue.md) |
| done | Calendar page (week/month view) | — | [plan](docs/superpowers/plans/2026-03-29-arr-phase1-calendar-quality-queue.md) |
| done | Download queue with rich metadata | — | [plan](docs/superpowers/plans/2026-03-29-arr-phase1-calendar-quality-queue.md) |
| done | Admin downloads panel with actions | — | [plan](docs/superpowers/plans/2026-03-29-arr-phase1-calendar-quality-queue.md) |

### Phase 2: Discovery, Collections, Credits (DONE)

| Status | Item | Issue | Spec/Plan |
|--------|------|-------|-----------|
| done | Overseerr/Seerr discovery passthrough (trending, popular, upcoming) | [#27](https://github.com/PetalCat/Nexus/issues/27) | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |
| done | Genre/network filtering for discovery | — | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |
| done | TMDB recommendations + similar via Seerr | — | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |
| done | /discover page with tabs + infinite scroll | — | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |
| done | Collections/franchises from Radarr + Seerr | [#41](https://github.com/PetalCat/Nexus/issues/41) | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |
| done | /collections browse page | — | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |
| done | Credits/cast via Seerr person endpoints | — | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |
| done | Person detail page (/person/{id}) with filmography | — | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |

### Phase 3: Power User & Admin (IN PROGRESS)

| Status | Item | Issue | Spec/Plan |
|--------|------|-------|-----------|
| planned | Subtitle management from player (Bazarr actions) | [#47](https://github.com/PetalCat/Nexus/issues/47) | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |
| planned | Health aggregation dashboard (all services + disk space) | — | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |
| planned | Issue reporting via Seerr | — | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |
| planned | Direct search triggers (Radarr/Sonarr/Lidarr/Bazarr commands) | — | [spec](docs/superpowers/specs/2026-03-29-arr-api-features-design.md) |

## Milestone 4: Cross-Service Intelligence (MOSTLY DONE)

Features that only work because Nexus connects everything.

| Status | Item | Issue | Spec/Plan |
|--------|------|-------|-----------|
| done | Universal Continue — one row across all media | [#40](https://github.com/PetalCat/Nexus/issues/40) | Calibre+RomM+Invidious+Jellyfin |
| done | Cross-media franchise pages | [#41](https://github.com/PetalCat/Nexus/issues/41) | — |
| done | Unified calendar across all media types | [#42](https://github.com/PetalCat/Nexus/issues/42) | Radarr+Sonarr+Lidarr+Invidious |
| done | Smart auto-requests based on viewing patterns | [#43](https://github.com/PetalCat/Nexus/issues/43) | — |
| done | Unified quality dashboard | [#46](https://github.com/PetalCat/Nexus/issues/46) | Admin panel done |
| done | Nexus Wrapped — annual stats all media | [#48](https://github.com/PetalCat/Nexus/issues/48) | — |
| future | AI-powered personal DJ and curator | [#44](https://github.com/PetalCat/Nexus/issues/44) | — |
| future | Social watch parties with SyncPlay | [#45](https://github.com/PetalCat/Nexus/issues/45) | — |
| future | Unified parental controls | [#49](https://github.com/PetalCat/Nexus/issues/49) | — |

## Milestone 5: Responsive + Accessibility

All UI working across screen sizes and input methods.

| Status | Item | Issue | Spec/Plan |
|--------|------|-------|-----------|
| planned | Audit all components for mobile responsiveness | — | — |
| planned | Audit all components for a11y (ARIA, keyboard, screen readers) | — | — |
| planned | Touch targets minimum 44x44px | — | — |
| planned | Mobile-optimized player controls | — | — |
| planned | Mobile-optimized admin dashboard | — | — |

## Milestone 5.5: Website & Messaging

Public-facing communication, onboarding language, and project positioning.

| Status | Item | Issue | Spec/Plan |
|--------|------|-------|-----------|
| planned | Public-facing website for Nexus | [#50](https://github.com/PetalCat/Nexus/issues/50) | — |
| planned | Non-affiliation and user-responsibility copy pass across website/docs/onboarding | [#50](https://github.com/PetalCat/Nexus/issues/50) | Clarify that Nexus is an independent frontend for user-configured services and does not provide media, accounts, or legal/privacy guarantees |
| planned | Replace direct consumer-brand-led marketing copy with neutral integration/adaptor language | [#50](https://github.com/PetalCat/Nexus/issues/50) | Avoid implying endorsement or official relationships with third-party platforms |
| planned | README and setup docs copy audit for neutral integration language | [#50](https://github.com/PetalCat/Nexus/issues/50) | Keep specific third-party names limited to compatibility/setup contexts where operationally necessary |
| planned | Add short non-affiliation disclaimer and user-responsibility note to website/docs/onboarding | [#50](https://github.com/PetalCat/Nexus/issues/50) | Make project boundaries explicit without leading public copy with legalese |

## Milestone 5.6: Issue & Tracking Hygiene

Bring GitHub issue descriptions and tracker status back in line with the actual product.

| Status | Item | Issue | Spec/Plan |
|--------|------|-------|-----------|
| planned | Rewrite thin or stale issue bodies for active roadmap items | — | Prioritize [#27](https://github.com/PetalCat/Nexus/issues/27), [#47](https://github.com/PetalCat/Nexus/issues/47), [#50](https://github.com/PetalCat/Nexus/issues/50), [#51](https://github.com/PetalCat/Nexus/issues/51) |
| planned | Update partially implemented issue descriptions to reflect current shipped status | — | Includes [#40](https://github.com/PetalCat/Nexus/issues/40), [#41](https://github.com/PetalCat/Nexus/issues/41), [#42](https://github.com/PetalCat/Nexus/issues/42), [#46](https://github.com/PetalCat/Nexus/issues/46), [#48](https://github.com/PetalCat/Nexus/issues/48) |
| planned | Close or final-pass issues that appear already implemented | — | Review [#52](https://github.com/PetalCat/Nexus/issues/52) and any other shipped items still open |
| planned | Keep roadmap, issue bodies, and shipped `main` features synchronized | — | Prevent tracker drift between GitHub issues, roadmap notes, and landed work |

## Milestone 6: TV Mode

10-foot UI with D-pad/remote navigation. Prerequisite for native apps.

| Status | Item | Issue | Spec/Plan |
|--------|------|-------|-----------|
| planned | Spatial navigation library (js-spatial-navigation + Svelte actions) | [#25](https://github.com/PetalCat/Nexus/issues/25) | [spec](docs/plans/2026-03-28-android-tv-support-design.md) |
| planned | TV layout shell (/tv route group) | [#25](https://github.com/PetalCat/Nexus/issues/25) | [spec](docs/plans/2026-03-28-android-tv-support-design.md) |
| planned | TV Home/Discover (hero + media rows + D-pad) | [#25](https://github.com/PetalCat/Nexus/issues/25) | [spec](docs/plans/2026-03-28-android-tv-support-design.md) |
| planned | TV Library (grid view by type) | [#25](https://github.com/PetalCat/Nexus/issues/25) | [spec](docs/plans/2026-03-28-android-tv-support-design.md) |
| planned | TV Search (letter grid + voice) | [#25](https://github.com/PetalCat/Nexus/issues/25) | [spec](docs/plans/2026-03-28-android-tv-support-design.md) |
| planned | TV Player (fullscreen, remote controls) | [#25](https://github.com/PetalCat/Nexus/issues/25) | [spec](docs/plans/2026-03-28-android-tv-support-design.md) |
| planned | TV PWA manifest + service worker | [#25](https://github.com/PetalCat/Nexus/issues/25) | [spec](docs/plans/2026-03-28-android-tv-support-design.md) |

## Milestone 7: Native Apps

Thin native shells wrapping the web UI. Blocked by Milestone 6.

| Status | Item | Issue | Spec/Plan |
|--------|------|-------|-----------|
| future | Kotlin shell (Android TV + Phone + Fire TV) | [#25](https://github.com/PetalCat/Nexus/issues/25) | [spec](docs/plans/2026-03-28-android-tv-support-design.md) |
| future | Native player handoff + download manager | [#25](https://github.com/PetalCat/Nexus/issues/25) | [spec](docs/plans/2026-03-28-android-tv-support-design.md) |
| future | Swift shell (iOS + macOS) | [#25](https://github.com/PetalCat/Nexus/issues/25) | [spec](docs/plans/2026-03-28-android-tv-support-design.md) |

## Milestone 8: New Adapters

Each adapter is one file + one registry line. Community contributions welcome.

### High Priority

| Status | Service | What it adds | Issue |
|--------|---------|-------------|-------|
| planned | **Seerr** | Successor to Overseerr, Jellyfin+Plex+Emby | [#27](https://github.com/PetalCat/Nexus/issues/27) |
| planned | **Readarr** | Book automation (Sonarr for books) | [#30](https://github.com/PetalCat/Nexus/issues/30) |
| planned | **Kapowarr** | Comic book collection manager | [#28](https://github.com/PetalCat/Nexus/issues/28) |
| planned | **Tdarr** | Transcode automation monitoring | [#29](https://github.com/PetalCat/Nexus/issues/29) |
| done | **Plex** | Plex Media Server support | [#24](https://github.com/PetalCat/Nexus/issues/24) |

### Medium Priority

| Status | Service | What it adds | Issue |
|--------|---------|-------------|-------|
| future | **Kometa** | Metadata & collection management | [#31](https://github.com/PetalCat/Nexus/issues/31) |
| future | **Maintainerr** | Library cleanup automation | [#32](https://github.com/PetalCat/Nexus/issues/32) |
| future | **Recyclarr** | TRaSH Guides quality sync | [#33](https://github.com/PetalCat/Nexus/issues/33) |
| future | **Notifiarr** | Push notification hub | [#34](https://github.com/PetalCat/Nexus/issues/34) |

### Future

| Status | Service | What it adds | Issue |
|--------|---------|-------------|-------|
| future | **Unpackerr** | Download extraction monitoring | [#35](https://github.com/PetalCat/Nexus/issues/35) |
| future | **Autobrr** | IRC download automation | [#36](https://github.com/PetalCat/Nexus/issues/36) |
| future | **Wizarr** | User invitation system | [#37](https://github.com/PetalCat/Nexus/issues/37) |
| future | **Trailarr** | Local trailer downloads | [#38](https://github.com/PetalCat/Nexus/issues/38) |
| future | **Posterizarr** | Poster generation | [#39](https://github.com/PetalCat/Nexus/issues/39) |
| done | **DeArrow** | YouTube thumbnail/title cleanup | [#22](https://github.com/PetalCat/Nexus/issues/22) |

---

## Execution Order

```
Milestone 3 Phase 3 (subtitles/health/issues/commands) ← NEXT
    ↓
Milestone 5 (responsive + a11y)
    ↓
Milestone 5.5 (website + messaging)
    ↓
Milestone 6 (TV mode)
    ↓
Milestone 7 (native apps)

Milestone 8 (new adapters) — ongoing, parallel with everything
```

## Existing Specs & Plans

### Design Specs
| File | Topic | Status |
|------|-------|--------|
| `docs/superpowers/specs/2026-03-28-adapter-consolidation-design.md` | Adapter architecture | Implemented |
| `docs/superpowers/specs/2026-03-29-arr-api-features-design.md` | *arr API features (3 phases) | Phase 1+2 done |
| `docs/superpowers/specs/2026-03-29-adapter-interface-migration-design.md` | Route-level import migration | Implemented |
| `docs/plans/2026-03-28-android-tv-support-design.md` | TV mode + native apps | Approved, not started |

### Implementation Plans
| File | Topic | Status |
|------|-------|--------|
| `docs/superpowers/plans/2026-03-28-adapter-consolidation.md` | Adapter consolidation (9 tasks) | Complete |
| `docs/superpowers/plans/2026-03-29-arr-phase1-calendar-quality-queue.md` | Calendar + quality + downloads (10 tasks) | Complete |
| `docs/superpowers/plans/2026-03-29-adapter-interface-migration.md` | Route migration (6 tasks) | Complete |

### Completed Plans (from previous sessions)
| File | Topic |
|------|-------|
| `docs/superpowers/plans/2026-03-26-open-beta-readiness.md` | Docker, CI/CD, testing |
| `docs/superpowers/plans/2026-03-26-books-ui-redesign.md` | PDF.js, foliate-js readers |
| `docs/superpowers/plans/2026-03-27-hero-trailers.md` | HeroSection, TrailerPlayer |
| `docs/superpowers/plans/2026-03-27-music-refresh.md` | Music playback, routes, Now Playing |
