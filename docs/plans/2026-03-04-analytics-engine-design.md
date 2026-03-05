# Nexus Analytics Engine — Design Document

## Principle
Data is power. Collect everything, expose everything, let the user decide what matters.

## Architecture: Two Event Streams + Computed Rollups

### 1. `media_events` (append-only)
Every media consumption action: play, pause, stop, complete, rate, like, favorite, etc.
Includes denormalized media info (title, year, genres, parent series/author/platform).
Rich metadata JSON: resolution, codecs, HDR, subtitles, CC, bitrate, transcoding, device, client.
Social signals: like/unlike, rate, favorite, watchlist, collection, share, mark_watched.

### 2. `interaction_events` (append-only)
Every UI interaction: page views, clicks, hovers, searches, filter changes, scroll depth, session timing.
Tracks position in UI (which row, which card index), referrer, duration.
Batched from client-side collector (flush every 5s + sendBeacon on unload).

### 3. `user_stats_cache` (pre-computed rollups)
Period-based aggregations: day, week, month, year, alltime.
Per media type + "all" aggregate.
Contains: consumption totals, top lists (items/genres/actors/directors/devices), technical profile (resolution/codec/HDR breakdown), social stats, activity patterns (hourly/weekday), streaks, discovery/engagement metrics.
Rebuilt on schedule: daily=5min, weekly=30min, monthly=2hr, yearly=6hr, alltime=12hr.

### 4. Ingestion Sources
- Webhook endpoint: `POST /api/ingest/webhook/[serviceType]`
- Session poller: background interval polling Jellyfin /Sessions (10s default)
- StreamyStats sync: periodic historical backfill
- Adapter hooks: lightweight events from adapter method calls
- Client-side collector: batched interaction events

### 5. Stats API
- `GET /api/user/stats` — single rollup by period+type
- `GET /api/user/stats/timeline` — time series for charts
- `GET /api/user/stats/top` — top-N lists
- `GET /api/user/stats/wrapped` — full year recap
- `GET /api/user/stats/live` — real-time today (computed on the fly)
- `GET /api/admin/stats/global` — server-wide (admin only)

### 6. StreamyStats Enrichment
When available: backfill historical data, actor/director metadata, embedding-based taste profiles, seasonal patterns. Merged as a stats provider, not sole source.
