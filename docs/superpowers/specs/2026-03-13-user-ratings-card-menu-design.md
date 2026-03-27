# User Ratings, Card Context Menu & Rating Labels

**Date:** 2026-03-13
**Status:** Approved

## Overview

Three related features:

1. **Server-wide user ratings** — 5-star (whole only) rating system per media item, stored locally, aggregated across all server users. Displayed in the media detail hero.
2. **Card three-dot context menu** — hover menu on `MediaCard` with "Add to Watchlist" toggle (using existing favorites system). Extensible for future actions.
3. **Rating source labels** — label external ratings by source (TMDB, IMDb, RT) and distinguish from the new Nexus community rating.

## 1. User Ratings

### Database

New `userRatings` table in `src/lib/db/schema.ts`:

| Column | Type | Notes |
|--------|------|-------|
| id | text (PK) | nanoid via `genId()` |
| userId | text (FK → users) | NOT NULL |
| mediaId | text | sourceId of the media, NOT NULL |
| serviceId | text | which service, NOT NULL |
| mediaType | text | media type string (movie/show/episode/etc.), for future display |
| rating | integer | 1-5, NOT NULL |
| createdAt | integer | unix ms |
| updatedAt | integer | unix ms |

- Unique constraint: `(userId, mediaId, serviceId)`
- Index on `(mediaId, serviceId)` for aggregate queries

### Server — `src/lib/server/ratings.ts`

Functions:

- `getUserRating(userId, mediaId, serviceId)` → `number | null`
- `upsertRating(userId, mediaId, serviceId, rating, meta: { mediaType, serviceType })` → `void`
  - Validates rating is integer 1-5
  - Invalidates cache key `rating-stats:${mediaId}:${serviceId}`
  - Emits `mediaEvent` with `eventType: 'rate'` using provided `serviceType`/`mediaType`
- `deleteRating(userId, mediaId, serviceId, meta: { serviceType, mediaType })` → `void`
  - Invalidates cache key `rating-stats:${mediaId}:${serviceId}`
  - Emits `mediaEvent` with `eventType: 'rate'`, metadata `{ cleared: true }`
- `getMediaRatingStats(mediaId, serviceId)` → `{ avg: number, count: number } | null`
  - Cache key: `rating-stats:${mediaId}:${serviceId}`, TTL 2 min via `withCache`
  - Returns null if no ratings exist

### API — `src/routes/api/media/[id]/ratings/+server.ts`

All routes require authenticated user (`locals.user`).

- **GET** `?service=xxx`
  - Returns `{ userRating: number|null, stats: { avg: number, count: number } | null }`
- **POST** `{ service: string, rating: number, mediaType: string, serviceType: string }`
  - Upserts rating, returns updated `{ userRating, stats }`
- **DELETE** `?service=xxx&serviceType=xxx&mediaType=xxx`
  - Removes user's rating, returns updated `{ userRating: null, stats }`

### UI — Star widget in media detail hero

Location: Zone C, above the action row.

- 5 outlined stars, inline-flex
- Hover: stars fill up to cursor position (gold/accent color)
- Click: submits rating immediately (no save button), stars stay filled
- Click existing rating again: clears it (DELETE), small "Rating cleared" text flashes briefly
- Aggregate text next to stars: "4.2 avg (3 ratings)" — only shows when ratings exist
- Optimistic UI: star fills instantly, API call in background
- Error: revert to previous state, show brief inline error

### Scope

Ratings apply to any media type (movies, shows, episodes, books, games, etc.). Episode-level and show-level ratings are independent.

### Data flow

1. `+page.server.ts` loads `getUserRating()` and `getMediaRatingStats()` alongside existing item data
2. Passed to page as `userRating` and `ratingStats`
3. Star widget reads these as initial state
4. On click, POST to API, update local state optimistically
5. `upsertRating`/`deleteRating` call `invalidate()` on the stats cache key so subsequent loads get fresh data

## 2. Card Three-Dot Context Menu

### Component — update `MediaCard.svelte`

On hover, show a `···` button (top-right corner):
- Small pill: `background: rgba(0,0,0,0.6); backdrop-filter: blur(8px)`
- Position: `absolute; top: 0.4rem; right: 0.4rem`
- Only appears on hover (opacity transition)
- Mobile (hover: none): always visible

On click, opens a dropdown menu:
- Position: anchored below the button, right-aligned
- Background: `var(--color-surface)` with border and shadow
- Menu items structured as `{ label, icon, action, active? }` for extensibility
- Initial items:
  - **"Add to Watchlist"** (bookmark outline icon) — if not in favorites
  - **"In Watchlist"** (filled bookmark icon + checkmark) — if already in favorites, click removes
- Close on: click outside, selecting action, escape key, mouse leaving card

### Data requirements

- User's favorites list needed to determine watchlist state per card
- Fetched client-side on mount via `/api/user/favorites`, stored in a Svelte store (`favoritesStore`)
- Store indexed by `mediaId:serviceId` for O(1) lookup of both watchlist state and favorite row ID
- On add: POST to `/api/user/favorites`, update store optimistically
- On remove: DELETE to `/api/user/favorites?id={favoriteRowId}`, update store optimistically
- Favorite row ID retrieved from the store index (avoids needing a delete-by-mediaId API variant)

### Interaction details

- Three-dot button click stops propagation (doesn't navigate to detail page)
- Menu click stops propagation
- Hover on card still shows play button — three-dot is in addition, not replacing
- Mobile: three-dot always visible (no hover state on touch)

## 3. Rating Source Labels

### Meta-strip changes in media detail hero

Replace the current unlabeled `★ 7.2` with source-labeled display.

**External rating pill:**
- Format: `{SOURCE} {score}` — e.g. "TMDB 7.2", "IMDb 7.8"
- Style: muted background pill, small uppercase source label + score
- Source derived from adapter/serviceType:
  - Jellyfin → "Community" (CommunityRating source varies by metadata provider config)
  - Overseerr → "TMDB" (voteAverage)
  - Radarr → "IMDb"
  - Sonarr → "TMDB"
  - Others → "Rating" (generic fallback)

**Critic rating pill:**
- Format: `Critic {score}%`
- Style: keep existing green tint, add "Critic" label

**Nexus community rating:**
- Format: `Nexus ★ {avg} ({count})`
- Style: accent-colored pill, only rendered when `ratingStats` exists (count > 0)
- Position: after external rating in the meta-strip

### Implementation

- Add a `ratingSource` derived value in the page component based on `data.serviceType`
- Update meta-strip template to use labeled format
- No backend changes needed — just template/display logic

## Files Changed

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add `userRatings` table |
| `src/lib/server/ratings.ts` | New — CRUD + aggregate functions |
| `src/routes/api/media/[id]/ratings/+server.ts` | New — GET/POST/DELETE |
| `src/routes/media/[type]/[id]/+page.server.ts` | Load user rating + stats |
| `src/routes/media/[type]/[id]/+page.svelte` | Star widget, rating labels |
| `src/lib/components/MediaCard.svelte` | Three-dot menu + watchlist toggle |
| `src/lib/stores/favorites.ts` | New — client-side favorites store |

## Out of Scope

- Rating from cards (only from detail page)
- Text reviews
- Rating history / activity feed integration
- Half-star ratings
- Rating on ContinueWatchingCard (only MediaCard gets the menu)
