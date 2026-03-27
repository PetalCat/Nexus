# Activity Hub Redesign — Design Spec

## Goal

Replace the current Activity Hub with a full analytics/insights dashboard, unified media history, and recommendation algorithm controls. The page becomes the central place to understand your media consumption patterns across all services and media types.

## Architecture

Three-tab layout (matching the Library page pattern):

1. **Insights** — analytics dashboard with 8 visualizations + period controls
2. **History** — unified chronological feed/table of all media consumption
3. **Recommendations** — algorithm dashboard with tuning, feedback, and transparency

Route structure: `/activity` redirects to `/activity/insights`. Each tab is a separate route under `/activity/`.

## Tab 1: Insights

### Period Controls

- **Preset buttons**: Today | 7 Days | 30 Days | Year | All Time
- **Custom date range**: two date inputs (from/to) with calendar pickers
- **Timeline slider**: draggable range slider showing the last 12 months. Two handles for from/to. Initial range matches the selected preset. No sparkline — keep it simple. Custom HTML `<input type="range">` pair, not a library.
- All controls sync — changing one updates the others
- Period selection persists in URL search params (`?from=TIMESTAMP&to=TIMESTAMP`). Presets are sugar that set from/to values.

### Stat Cards (top row, 4 columns, 2 columns on mobile)

| Card | Value | Subtext | Comparison |
|------|-------|---------|------------|
| Watch Time | total hours+minutes | "across N sessions" | % change vs previous period |
| Items Consumed | count | breakdown by type (derived from topItems) | +/- vs previous period |
| Current Streak | days | "longest: N days" | motivational text |
| Completion Rate | percentage | "X of Y finished" | % change vs previous period |

Items Consumed breakdown: group `topItems` by `mediaType` and count unique items per type.

### Visualizations

**Row 1** (2:1 grid, stacks on mobile):
- **Watch Time Bar Chart** (2/3 width): Hours per day/week/month depending on period. Gradient bars (accent gold). Hover tooltip shows exact value. X-axis labels adapt to granularity.
- **Media Type Donut** (1/3 width): Proportional time by media type (movie, show, book, game, video, music). Center shows total. Legend beside donut.

**Row 2** (3-column grid, stacks to 1-col on mobile):
- **Genre Bars**: Horizontal bar chart of top 6 genres by time. Gradient fills using the color palette. Shows time label inside bar.
- **Viewing Heatmap**: 7-row (Mon–Sun) × 24-column (hours) grid. Cell opacity = consumption intensity. Accent gold color scale. On mobile: horizontal scroll within card.
- **Top Items**: Ranked list (top 5) with poster thumbnail, title, type, genre, total time. Gold rank number for #1.

**Row 3** (2-column grid, stacks on mobile):
- **Activity Calendar + Streaks**: GitHub contribution-style year grid (52×7). Three stats above: current streak, longest streak, active days. Cell opacity = daily consumption level. On mobile: horizontal scroll.
- **Playback Details**: Three stacked sections — Devices (segmented bar), Clients (segmented bar), Quality stats (4 metrics: 4K%, HDR%, Transcode%, Subtitle%).

### Chart Library

Use **Chart.js** via `svelte-chartjs` for the bar chart and donut. Chart.js is well-maintained, has good dark theme support, and its ~60KB gzip is acceptable since this is a data-heavy page. All other visualizations (heatmap, genre bars, calendar, device bars, quality stats, top items) are pure Svelte + CSS.

### Data Sources

**Backend changes needed:**

The existing `/api/user/stats` only accepts period strings (`day:YYYY-MM-DD`, `week:YYYY-WNN`, etc.), not arbitrary from/to ranges. Add support for arbitrary ranges:

- **Modify `/api/user/stats`**: accept optional `from` and `to` query params (unix ms). When present, call `computeStats(userId, from, to, mediaType)` directly instead of `getOrComputeStats()`. These bypass the cache (arbitrary ranges aren't worth caching).
- **Modify `/api/user/stats/timeline`**: already accepts `from`/`to` — no changes needed.
- **Modify `queryMediaEvents()`**: add optional `serviceId` and `titleSearch` filter params for History tab.

**Insights page.server.ts** computes all data SSR:
1. Call `computeStats(userId, from, to)` for current period → stat cards, all chart data
2. Call `computeStats(userId, prevFrom, prevTo)` for previous period → comparison deltas
3. Call timeline endpoint data (or compute inline) for bar chart
4. Return everything as one payload. Charts render client-side from this SSR data.

**Loading states**: Each chart card shows a subtle pulse skeleton (same dimensions as the chart) while SSR data hydrates. Since data is SSR'd, this is only visible on client-side navigation between periods.

**Empty states**: When a period has zero events, stat cards show "0" values, charts show a centered message: "No activity in this period." The calendar always renders (empty cells just have minimal opacity).

**Error states**: If stats computation fails, show an error banner above the charts: "Couldn't load analytics. Try refreshing." Individual chart failures don't happen since all data comes from one SSR payload.

## Tab 2: History

### Default View: Timeline Feed

Chronological feed of all media events, grouped by day:
- Day headers ("Today", "Yesterday", "March 10, 2026")
- Each entry: poster thumbnail (from Jellyfin image URL using `mediaId`), title, media type badge, duration/progress, timestamp
- Media types color-coded: movies (accent), shows (steel), books (warm), games (steel-light), videos (accent-light), music (faint)
- Clicking an entry navigates to the media detail page
- Infinite scroll with pagination (load 50 at a time via client-side fetch)

**Poster hydration strategy**: The events table stores `media_id` and `service_id`. For Jellyfin items, poster URLs are constructable without an API call: `/Items/{mediaId}/Images/Primary` (public, no auth). For other services, show the media type icon as fallback. No expensive adapter hydration calls.

### Alternate View: Table

Toggle between Feed and Table view (segmented control top-right). Shared filters apply to both.

Table columns: Title, Type, Duration/Progress, Service, Device, Date. Sortable by any column. Dense rows.

### Filters (shared between views)

- **Media type chips**: All | Movies | Shows | Books | Games | Videos | Music (multi-select)
- **Search**: text filter on title (client-side filter on loaded results + server-side `LIKE` for new fetches)
- **Date range**: independent date inputs
- **Service filter**: dropdown of connected services
- **Event type**: dropdown (watched, completed, started, rated, etc.)

### Data Source

**Backend changes needed:**
- Extend `queryMediaEvents()` to accept optional `serviceId` filter and `titleSearch` (SQL `LIKE '%term%'` on `media_title`)
- Extend `/api/user/stats/events` to pass these new params through

**Loading state**: Skeleton rows while fetching. Infinite scroll shows a small spinner at bottom.

**Empty state**: "No history yet. Start watching, reading, or playing something!"

## Tab 3: Recommendations

### Availability

The Recommendations tab is only shown when the user has a StreamyStats service configured. If not configured, the tab still appears but shows a setup prompt: "Connect StreamyStats in Settings to get personalized recommendations." with a link to `/settings`.

### Section 1: Active Recommendations

Display current StreamyStats recommendations with full transparency:
- Poster grid (3 columns desktop, 2 mobile) of recommended items
- Each card shows: poster, title, type, **reason** ("Because you watched X"), **similarity score** (0–100%), **basedOn** items listed
- Thumbs up / thumbs down buttons on each recommendation for feedback
- "Not interested" (X button) dismisses the item permanently

Over-fetch from StreamyStats: request `limit=50` to compensate for client-side filtering. Display up to 20 after applying preferences.

### Section 2: Algorithm Tuning

**Media type weights** (sliders):
- Movies / Shows / Books / Games / Music / Videos: 0–100 weight slider each
- Default: all at 50
- Controls relative proportion of each type in filtered results

**Genre preferences**:
- List all genres the user has consumed (derived from stats `topGenres`)
- Each genre: boost / neutral / suppress tri-state toggle
- Suppressed genres filter out matching results; boosted genres sort higher

**Similarity threshold** slider:
- Low (0.3, adventurous) → High (0.9, safe)
- Filters results below the threshold

### Section 3: Feedback History

- Table of all thumbs up/down/dismiss feedback given
- Shows: item title, feedback type, date, reason it was recommended
- Delete button to undo feedback (removes the row)

### Data & Storage

**New tables:**
- `recommendation_preferences`: `user_id` (PK), `media_type_weights` (JSON), `genre_preferences` (JSON), `similarity_threshold` (real, default 0.5), `updated_at` (int)
- `recommendation_feedback`: `id` (PK), `user_id`, `media_id`, `media_title`, `feedback` (text: up/down/dismiss), `reason` (text), `created_at` (int)

**New API endpoints:**
- `GET /api/user/recommendations` — fetches StreamyStats recs (limit=50), applies server-side preference filtering, returns filtered+sorted list
- `POST /api/user/recommendations/feedback` — stores feedback `{ mediaId, mediaTitle, feedback, reason }`
- `DELETE /api/user/recommendations/feedback/[id]` — removes a feedback entry (undo)
- `GET /api/user/recommendations/preferences` — returns current tuning settings
- `PUT /api/user/recommendations/preferences` — updates tuning `{ mediaTypeWeights, genrePreferences, similarityThreshold }`

**Loading state**: Skeleton poster cards while StreamyStats responds.

**Empty state** (no recs): "Not enough watch history for recommendations yet. Keep watching!"

**Error state** (StreamyStats unreachable): "Couldn't reach StreamyStats. Recommendations will refresh automatically."

## Route Structure

```
/activity                           → redirect to /activity/insights
/activity/+layout.svelte            → tab bar + auth gate
/activity/+layout.server.ts         → auth check, return user + hasStreamyStats flag
/activity/insights/+page.svelte     → dashboard with all 8 charts
/activity/insights/+page.server.ts  → computeStats for current + prev period, timeline data
/activity/history/+page.svelte      → timeline feed + table toggle
/activity/history/+page.server.ts   → initial 50 events (SSR)
/activity/recommendations/+page.svelte     → recs + tuning + feedback
/activity/recommendations/+page.server.ts  → load prefs + current recs + feedback history
```

## New Files

```
src/routes/activity/+layout.svelte
src/routes/activity/+layout.server.ts
src/routes/activity/insights/+page.svelte
src/routes/activity/insights/+page.server.ts
src/routes/activity/history/+page.svelte
src/routes/activity/history/+page.server.ts
src/routes/activity/recommendations/+page.svelte
src/routes/activity/recommendations/+page.server.ts
src/routes/api/user/recommendations/+server.ts
src/routes/api/user/recommendations/feedback/+server.ts
src/routes/api/user/recommendations/feedback/[id]/+server.ts
src/routes/api/user/recommendations/preferences/+server.ts
src/lib/components/charts/WatchTimeChart.svelte
src/lib/components/charts/MediaDonut.svelte
src/lib/components/charts/GenreBars.svelte
src/lib/components/charts/ViewingHeatmap.svelte
src/lib/components/charts/ActivityCalendar.svelte
src/lib/components/charts/DeviceBreakdown.svelte
src/lib/components/charts/QualityStats.svelte
src/lib/components/charts/TopItems.svelte
src/lib/components/history/HistoryFeed.svelte
src/lib/components/history/HistoryTable.svelte
src/lib/components/history/HistoryFilters.svelte
```

## Modified Files

```
src/routes/activity/+page.server.ts  → replace with redirect(302, '/activity/insights')
src/routes/activity/+page.svelte     → delete (replaced by sub-routes)
src/lib/db/schema.ts                 → add recommendation_preferences, recommendation_feedback tables
src/lib/db/index.ts                  → add table creation for new tables
src/lib/server/stats-engine.ts       → no changes (computeStats already accepts from/to)
src/routes/api/user/stats/+server.ts → add from/to query param support
src/routes/api/user/stats/events/+server.ts → add serviceId, titleSearch params
src/routes/+layout.svelte            → update nav activeId for /activity sub-routes
```

## Dependencies

- **Chart.js** + **svelte-chartjs**: bar chart and donut chart (install via pnpm)
- All other visualizations: pure Svelte + CSS (no additional dependencies)

## Mobile Responsiveness

- **Stat cards**: 4-col → 2-col grid at `<768px`
- **Chart rows**: stack to single column at `<768px`
- **Heatmap + Calendar**: horizontal scroll within their cards on mobile
- **History feed**: full-width, same layout (already single-column)
- **History table**: horizontal scroll on mobile
- **Recommendations grid**: 3-col → 2-col → 1-col

## Design System

Follows existing Nexus dark space theme:
- Card backgrounds: `bg-raised` with `border-cream/[0.06]`
- Primary accent: gold (`#d4a253`) for most chart elements
- Secondary: steel teal (`#3d8f84`) for secondary data
- Tertiary: warm red (`#c45c5c`) for tertiary/warning
- Text: cream primary, muted secondary, faint tertiary
- Typography: Playfair Display for large numbers, DM Sans for everything else
- Radius: 12px for cards, 8px for inner elements
