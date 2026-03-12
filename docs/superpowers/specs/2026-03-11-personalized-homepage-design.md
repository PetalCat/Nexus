# Personalized Homepage — Design Spec

## Overview

Replace the current minimal homepage (Continue Watching + New in Library) with a Netflix-style personalized feed. The recommendation engine already computes scored content via 6 providers — this spec surfaces that data as the homepage experience.

## Goals

- Homepage becomes the primary recommendation surface (replaces `/for-you` as the main entry point)
- Load time <100ms via pre-computed cache
- Graceful degradation for new users and service outages
- User-reorderable rows

## Non-Goals (Deferred to Later Specs)

- Row reorder drag UI (recommendation settings spec)
- Genre boost/ban controls (recommendation settings spec)
- Stats/analytics dashboard (stats spec)
- Admin recommendation controls (admin spec)

---

## Architecture

### Approach: Pre-computed Rows

The recommendation scheduler already pre-computes recommendations every 60min. We extend it to also build homepage-ready row layouts per user and cache them. The homepage load reads the cache — no computation on request.

Continue Watching is the sole exception: always fetched live from Jellyfin since it changes with every play/pause.

### Data Flow

```
Rec Scheduler (every 60min)
  → reads recommendation_cache (already computed)
  → buildHomepageCache(userId)
  → groups into hero + rows
  → stores in user_homepage_cache

Page Load
  → parallel: getContinueWatching(live) + getHomepageCache(cached)
  → merge Continue Watching as row 0
  → apply user's rowOrder
  → serve
```

---

## Homepage Layout

### Hero Carousel

- 5-8 top-scored recommendations with backdrop images
- Auto-advances every 8-10 seconds
- Pauses on hover/focus
- Dot indicators + left/right arrow navigation
- Swipe support on touch devices
- Each slide shows: backdrop, title, year, runtime, rating, overview, reason badge ("TOP PICK · Because you like Sci-Fi"), Play + More Info buttons
- Preloads next backdrop image for smooth transitions
- If <1 hero-worthy item: no hero section, start with rows

### Row Order (Default)

1. **Continue Watching** — always position 0, not reorderable, live from Jellyfin
2. **Trending Now** — from trending provider, fire emoji, velocity-scored
3. **From Friends** — shared/watched by friends, social context ("Alex watched this")
4. **Right Now** — time-aware provider, only shown if current hour has genre matches
5. **Recommended for You** — catch-all for similar_users, similar_item, studio_match, era_match, completion_pattern, external reason types
6. **New in Library** — recent server additions, not personalized
7. **Genre rows** — ordered by user's genre affinity ranking ("Sci-Fi — Your #1 genre"), one row per top genre

### Row Behavior

- Rows with no data are silently skipped
- Genre rows appear in affinity order (highest first)
- `genre:*` in rowOrder means "all genre rows in affinity order"
- Users can pin specific genres or reorder individually (UI in settings spec)
- New row types added in the future appear at the end

---

## Data Shapes

### Hero Item

```typescript
interface HeroItem {
  id: string;
  serviceId: string;      // needed for routing to /media/[type]/[id] and stream URLs
  title: string;
  year: number;
  runtime: string;        // "2h 46m"
  rating: number;
  overview: string;
  backdrop: string;       // image URL
  poster: string;
  mediaType: string;
  reason: string;         // "Because you like Sci-Fi"
  provider: string;       // which rec provider sourced it
}
```

### Homepage Row

```typescript
interface HomepageRow {
  id: string;             // "trending", "friends", "new", "genre:drama", "recommended"
  title: string;          // "Trending Now"
  subtitle?: string;      // "Your #1 genre"
  type: 'reason' | 'genre' | 'system';
  // type mapping: reason = trending/friends/time-aware/recommended,
  //               genre = genre:* rows,
  //               system = continue/new (non-recommendation rows)
  items: HomepageItem[];
}
```

### Homepage Item

```typescript
interface HomepageItem {
  id: string;
  serviceId: string;      // needed for routing to /media/[type]/[id] and stream URLs
  title: string;
  poster: string;
  year: number;
  mediaType: string;
  context?: string;       // "Alex watched this", "Shared by Maya"
  progress?: number;      // 0-1, only for Continue Watching
  timeRemaining?: string; // "35m left", only for Continue Watching
  episodeInfo?: string;   // "S3E4", only for Continue Watching
}
```

---

## Pre-computation Pipeline

### `buildHomepageCache(userId)`

Runs every 60min per active user. Triggered in `startRecScheduler` at the same tick as `precomputeRecs` (tick % 12 === 0), immediately **after** recommendations are computed so it reads fresh data:

1. Read latest recommendations from `recommendation_cache`
2. Select top 5-8 highest-scored items with backdrop images → hero carousel
3. Group remaining items by reason type:
   - `genre_match` → split into per-genre rows, ordered by `user_genre_affinity` ranking
   - `trending` → "Trending Now" row
   - `friend_shared` / `friend_watched` → "From Friends" row with social context strings
   - `time_pattern` → "Right Now" row
   - `similar_users` / `similar_item` / `studio_match` / `era_match` / `completion_pattern` / `external` → "Recommended for You" catch-all row (sorted by score)
4. Fetch "New in Library" (latest 20 items, uses existing cached call)
5. Assemble into row data shapes
6. Store in `user_homepage_cache`

### Cache Storage

In-memory via existing `withCache` utility:

```typescript
// Cache key: `homepage:${userId}`
// TTL: 60min (aligned with scheduler rebuild interval)
// Value shape:
{
  hero: HeroItem[];
  rows: HomepageRow[];    // pre-ordered by default, reordered at serve time
  computed_at: number;    // timestamp
}
```

In-memory `withCache` is the right choice — the scheduler rebuilds every 60min, and cache loss (server restart) triggers cold-start fallback gracefully. No SQLite table needed since this is a derived view of `recommendation_cache` (which is already persisted).

### Cache Invalidation

- Rebuilt on schedule (every 60min)
- Invalidated when user updates rec profile (weight changes, genre bans)
- Invalidated when user hides/unhides an item
- NOT invalidated on play events (Continue Watching is live)

---

## Server Load Function

### `+page.server.ts`

```
load({ locals }) {
  // Parallel fetch
  const [continueWatching, homepageCache] = await Promise.all([
    getContinueWatching(userId, userCred),  // live Jellyfin call
    getHomepageCache(userId)                 // pre-computed cache read
  ]);

  if (homepageCache) {
    // Apply user's rowOrder from rec profile
    const rows = applyRowOrder(homepageCache.rows, userProfile.rowOrder);
    // Inject Continue Watching as row 0
    rows.unshift(continueWatchingRow);
    return { hero: homepageCache.hero, rows };
  }

  // Cold start fallback
  return coldStartHomepage(continueWatching, userId);
}
```

---

## Cold Start (New Users)

When no recommendation cache exists for a user:

- **Show:** Continue Watching (if any) + New in Library + Popular on Server (trending provider, no personalization)
- **Skip:** All personalized rows, genre rows, social rows
- **No hero carousel** — or show New in Library items as hero if they have backdrops
- **No onboarding wizard** — data accumulates naturally from usage
- Scheduler picks up new user within 5min (affinity build), 60min (full homepage cache)

---

## Frontend Components

### Existing (reuse as-is)

- **`MediaRow`** — horizontal scrollable row, used for all content rows
- **`DashboardRow`** — wrapper with title + subtitle
- **`MediaCard`** — poster card for items

### New Components

**`HeroCarousel.svelte`**
- Accepts `items: HeroItem[]`
- Renders backdrop + metadata + Play/More Info buttons
- Auto-advance timer (8s), pauses on hover/focus
- Dot indicators + arrow navigation
- Preloads next backdrop
- Reason badge display
- Touch swipe support
- Accessible: keyboard navigation, aria-live for slide changes

**`ContinueWatchingCard.svelte`**
- Landscape aspect ratio (16:9) instead of standard poster (2:3)
- Progress bar overlay at bottom
- Episode info ("S3E4") and time remaining text
- Wraps or extends existing MediaCard

### Route Changes

- **`/` (homepage):** Rewrite `+page.server.ts` and `+page.svelte` to use new data shapes
- **`/for-you`:** Replace with a redirect stub (`+page.server.ts` returns `redirect(301, '/')`) and delete the old page component

---

## Row Reordering

### Storage

Extends `RecProfileConfig` in `src/lib/server/recommendations/types.ts` with new optional field:

```typescript
rowOrder?: string[]
// e.g., ["continue", "trending", "friends", "time-aware", "new", "genre:*"]
// If undefined/missing, uses default order
```

Existing profiles without `rowOrder` gracefully default to the standard order defined in the Row Order section.

### Behavior

- `rowOrder` applied at serve time (not in cache)
- Continue Watching always position 0 regardless of `rowOrder`
- `genre:*` expands to all genre rows in affinity order
- Individual genres can be pinned: `["continue", "genre:sci-fi", "trending", ...]`
- Missing row IDs in `rowOrder` appended at end
- Actual reorder UI deferred to recommendation settings spec

---

## Performance

### Targets

- Homepage load: <100ms for cache read; Jellyfin Continue Watching call runs in parallel and is bounded by network latency (typically <500ms). Page renders immediately with cached rows; Continue Watching row appears when the Jellyfin call resolves.
- Hero images: lazy-load all but first slide, preload next on timer
- Row images: lazy-load with intersection observer (existing pattern)

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| No Jellyfin credential | Skip Continue Watching, show cache-only rows |
| Jellyfin unreachable | Continue Watching shows inline error, rest loads from cache |
| <5 hero items | Fewer dots, minimum 1. Zero → no hero section |
| Empty reason row (<3 items) | Skip row entirely |
| Cache >2hr stale | Still serve — stale recs > no recs. Scheduler catches up |
| First login, no cache | Cold start view. Eager build not required for v1 |
| User has no events | Cold start: New in Library + server-wide Trending only |

---

## Testing Strategy

- **Unit:** `buildHomepageCache` with mock recommendation data → verify row grouping, hero selection, genre ordering
- **Unit:** `applyRowOrder` with various orderings → verify Continue Watching always first, genre expansion works
- **Integration:** Full page load with pre-seeded cache → verify <100ms, correct data shape
- **Integration:** Cold start path → verify fallback rows render correctly
- **Component:** HeroCarousel — auto-advance timer, pause on hover, keyboard nav, swipe
- **Component:** ContinueWatchingCard — progress bar accuracy, episode info display
