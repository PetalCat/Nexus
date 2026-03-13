# Tracking System Rebuild — Design Spec

## Problem

The current media event tracking system produces wildly inaccurate stats. A 30-minute episode shows 10+ hours of watch time. Root causes:

1. **Event duplication** — 5 event sources (session poller, webhook, stream progress API, video progress API, book progress API) all fire independently with zero coordination. A single playback generates hundreds of rows.
2. **Bad duration data** — `play_duration_ms` tracks wall-clock session uptime, not actual media consumption. `duration_ticks` is often null, so there's no cap.
3. **Late dedup** — Deduplication happens at stats query time, not at write time. Even best-effort dedup can't fix fundamentally bad source data.

## Solution

Replace the append-only `media_events` table with a **session-based model**: one row per playback/reading/gaming session. The session poller owns the lifecycle for video; webhooks enrich but never create sessions.

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Session model scope | Unified for all media types | Books/games fill in what they can; same table, less code |
| Video session authority | Poller creates, webhook enriches | Single writer prevents duplication; webhooks add metadata |
| Old data migration | Drop `media_events`, clean slate | Old data is too corrupted to salvage |
| Stats caching | Hybrid — direct queries for recent, cache for long-range | Simple now, scales later |

---

## Schema

### New table: `play_sessions`

```sql
CREATE TABLE play_sessions (
  id            TEXT PRIMARY KEY,          -- nanoid or uuid
  session_key   TEXT UNIQUE,              -- e.g. 'serviceId:jellyfinSessionId' for idempotent upserts
  user_id       TEXT NOT NULL,
  service_id    TEXT NOT NULL,
  service_type  TEXT NOT NULL,             -- 'jellyfin', 'calibre', 'romm'
  media_id      TEXT NOT NULL,
  media_type    TEXT NOT NULL,             -- 'movie', 'episode', 'book', 'game', 'music', 'live'
  media_title   TEXT,
  media_year    INTEGER,
  media_genres  TEXT,                      -- JSON array
  parent_id     TEXT,                      -- show ID for episodes, series for books
  parent_title  TEXT,
  started_at    INTEGER NOT NULL,          -- unix ms
  ended_at      INTEGER,                   -- null = still active
  duration_ms   INTEGER DEFAULT 0,         -- actual consumption time (pause-excluded)
  media_duration_ms INTEGER,               -- runtime of the media itself
  progress      REAL,                      -- 0.0–1.0
  completed     INTEGER DEFAULT 0,         -- boolean
  device_name   TEXT,
  client_name   TEXT,
  metadata      TEXT,                      -- JSON: resolution, codecs, HDR, transcode, etc.
  source        TEXT NOT NULL,             -- 'poller', 'webhook', 'progress-api', 'manual'
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_ps_user_started ON play_sessions(user_id, started_at);
CREATE INDEX idx_ps_user_media ON play_sessions(user_id, media_id);
CREATE INDEX idx_ps_user_type ON play_sessions(user_id, media_type);
CREATE INDEX idx_ps_active ON play_sessions(ended_at) WHERE ended_at IS NULL;
```

The `session_key` column enables crash recovery: if the server restarts mid-session, the poller can use `INSERT ... ON CONFLICT(session_key) DO UPDATE` to resume tracking an existing session rather than creating a duplicate.

### Drizzle schema addition (`src/lib/db/schema.ts`)

```typescript
export const playSessions = sqliteTable('play_sessions', {
  id: text('id').primaryKey(),
  sessionKey: text('session_key').unique(),
  userId: text('user_id').notNull(),
  serviceId: text('service_id').notNull(),
  serviceType: text('service_type').notNull(),
  mediaId: text('media_id').notNull(),
  mediaType: text('media_type').notNull(),
  mediaTitle: text('media_title'),
  mediaYear: integer('media_year'),
  mediaGenres: text('media_genres'),
  parentId: text('parent_id'),
  parentTitle: text('parent_title'),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  durationMs: integer('duration_ms').default(0),
  mediaDurationMs: integer('media_duration_ms'),
  progress: real('progress'),
  completed: integer('completed').default(0),
  deviceName: text('device_name'),
  clientName: text('client_name'),
  metadata: text('metadata'),
  source: text('source').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
});
```

### Tables removed

- `media_events` — dropped entirely (all data lost, intentional clean slate)
- `user_stats_cache` — dropped; replaced by simpler rollup (see Stats section)

### Tables kept as-is

- `interaction_events` — UI analytics, unrelated to playback tracking
- `activity` — legacy progress table, still used by stream progress API
- `book_reading_sessions` — already session-based, will be unified into `play_sessions` later (out of scope for v1)

---

## Session Lifecycle

### Video (Jellyfin) — Poller-owned

The session poller (`session-poller.ts`) polls Jellyfin `/Sessions` every 10 seconds. It directly creates/updates `play_sessions` rows instead of emitting events.

**In-memory state** remains for tracking pause timing between polls. The `TrackedSession` interface stays similar but now references a `play_sessions.id` instead of emitting events.

#### State transitions

```
[No session] → NowPlayingItem detected
  → INSERT play_sessions (endedAt = null, durationMs = 0)
  → Store in-memory tracker with startedAt, pausedSinceAt, totalPausedMs

[Active, playing] → Still playing (next poll)
  → durationMs += 10s (poll interval)
  → UPDATE progress = positionTicks / mediaDurationMs
  → UPDATE updatedAt

[Active, playing] → IsPaused = true
  → Record pausedSinceAt = now in memory
  → Stop incrementing durationMs
  → UPDATE updatedAt

[Active, paused] → IsPaused = false
  → Add (now - pausedSinceAt) to totalPausedMs in memory
  → Resume incrementing durationMs
  → UPDATE updatedAt

[Active] → Session disappears from /Sessions
  → SET endedAt = now
  → Final durationMs = (now - startedAt) - totalPausedMs, capped at mediaDurationMs * 1.1
  → SET completed = 1 if progress >= 0.9
  → UPDATE updatedAt

[Active] → Media changes (different item.Id)
  → Close current session (as above)
  → Open new session (as "No session" above)
```

#### Guard rails

- `durationMs` can never exceed `mediaDurationMs * 1.1` (10% tolerance for credits/buffering)
- `mediaDurationMs` fetched from Jellyfin `RunTimeTicks` at session creation — if null, fetch via `/Items/{id}` API call
- Stale session cleanup: sessions open with no `updatedAt` change get auto-closed after `max(mediaDurationMs * 1.5, 4 hours)` — this handles both extended cuts (LotR, etc.) and sessions where runtime is unknown
- If poller fails to reach a Jellyfin server, sessions for that server are preserved (existing behavior)

#### Duration increment logic

The poller fires every 10 seconds. For an active, non-paused session:

```typescript
// In the poller tick, for each active non-paused session:
const elapsed = now - tracker.lastTickAt;  // ~10,000ms
session.durationMs += elapsed;
tracker.lastTickAt = now;
```

This is more accurate than the old approach of computing `(now - startedAt) - totalPausedMs` at stop time, because it doesn't accumulate error from missed polls or timing jitter.

### Video (Jellyfin) — Webhook enrichment

The webhook handler (`/api/ingest/webhook/jellyfin`) changes from creating events to enriching existing sessions:

- **ItemAdded, UserDataSaved, ItemRated** — These non-playback events are stored in a new lightweight `media_actions` log (see below), not in `play_sessions`.
- **PlaybackStart/Stop/Progress** — Webhooks for playback are **ignored** (poller is authoritative). If no open session exists for the media, the webhook is a no-op.
- **Metadata enrichment** — If a webhook fires for media that has an open session, merge its metadata into the session's `metadata` JSON column. Strategy: for each key in the webhook metadata, if the key is missing or null in the existing session metadata, set it. Never overwrite non-null values.

### Progress API endpoints

Three existing endpoints call `emitMediaEvent()` for progress tracking. Their new roles:

- **`/api/stream/[serviceId]/progress`** (video stream progress) — **Removed as event source.** The poller is authoritative for video. This endpoint may still update the `activity` table for UI progress bars but no longer writes to `play_sessions` or emits events.
- **`/api/video/progress`** (video progress) — Same as above: poller is authoritative, stop emitting events.
- **`/api/books/[id]/progress`** (book progress) — **Converted to session writer.** This becomes the primary mechanism for creating/updating book `play_sessions`. On each progress report: find or create a session, update progress and duration (see Books lifecycle section).

### Detail view tracking

The media detail page (`/media/[type]/[id]/+page.server.ts`) currently calls `emitMediaEvent()` with `detail_view`. This is a UI interaction, not a playback session. Move it to `emitMediaAction()` with `action_type = 'detail_view'` in `media_actions`.

### Non-playback actions: `media_actions` table

Lightweight table for non-session events (ratings, library additions, marks, etc.):

```sql
CREATE TABLE media_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  service_id  TEXT NOT NULL,
  service_type TEXT NOT NULL,
  action_type TEXT NOT NULL,    -- 'rate', 'mark_watched', 'add_to_library', 'complete', 'watchlist_add', etc.
  media_id    TEXT NOT NULL,
  media_type  TEXT NOT NULL,
  media_title TEXT,
  metadata    TEXT,             -- JSON: rating value, etc.
  timestamp   INTEGER NOT NULL
);

CREATE INDEX idx_ma_user ON media_actions(user_id, timestamp);
```

This replaces the non-playback events that currently go into `media_events`.

### Games (RomM) — Status-change sessions

The RomM poller detects game status changes (playing, finished, completed, etc.). On status change:

- If status → `playing`: INSERT a new session (`endedAt = null`, `source = 'poller'`)
- If status → `finished`/`completed`/`retired`: Close any open session for that game, set `completed = 1`
- `durationMs` for games comes from RomM's `last_played` metadata if available; otherwise estimated from time between status changes, capped at 4 hours
- `mediaDurationMs` is null for games (no fixed runtime)

### Books (Calibre) — Progress-based sessions

Books don't have real-time playback tracking. Sessions are created/updated when progress changes:

- When book progress is reported (via existing progress API or future Calibre adapter):
  - If no open session exists for this book: INSERT new session
  - If open session exists and last update was < 2 hours ago: UPDATE progress, increment durationMs by time since last update
  - If open session exists but last update was > 2 hours ago: Close old session, open new one
- `mediaDurationMs` = estimated reading time based on page count (optional, can be null)
- `durationMs` = time between progress updates, capped at 2 hours per update gap

---

## Stats Computation

### Direct queries (replaces `stats-engine.ts`)

The new `computeStats()` queries `play_sessions` directly. No dedup needed — one row per session.

```sql
-- Total play time for a user in a period
SELECT COALESCE(SUM(duration_ms), 0) as total_ms
FROM play_sessions
WHERE user_id = ? AND started_at >= ? AND started_at < ?

-- Top items
SELECT media_id, media_title, media_type,
       SUM(duration_ms) as play_time_ms,
       COUNT(*) as sessions
FROM play_sessions
WHERE user_id = ? AND started_at >= ? AND started_at < ?
GROUP BY media_id
ORDER BY play_time_ms DESC
LIMIT 20

-- Daily timeline
SELECT date(started_at / 1000, 'unixepoch') as day,
       SUM(duration_ms) as total_ms,
       COUNT(*) as sessions
FROM play_sessions
WHERE user_id = ? AND started_at >= ? AND started_at < ?
GROUP BY day
ORDER BY day

-- Social signals (from media_actions)
SELECT action_type, COUNT(*) as count
FROM media_actions
WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
GROUP BY action_type
-- Maps to: totalLikes (like), totalRatings (rate), totalFavorites (watchlist_add)
```

The `ComputedStats` interface shape is preserved. Playback fields come from `play_sessions`, social signal fields (`totalLikes`, `totalRatings`, `totalFavorites`) come from `media_actions`, and interaction fields (`totalPageViews`, etc.) still come from `interaction_events`.

### Period string format

Period strings remain unchanged: `'day:2026-03-04'`, `'week:2026-W10'`, `'month:2026-03'`, `'year:2026'`, `'alltime'`. The `parsePeriod()` function is preserved. The only difference is that `stats_rollups` only stores monthly/yearly/alltime — daily and weekly are always computed on-demand from `play_sessions`.

### Caching strategy

- **7 days and 30 days**: Query `play_sessions` directly. With proper indexes on `(user_id, started_at)`, this is fast even with thousands of sessions.
- **Monthly/Yearly/Alltime**: Pre-compute into a simplified `stats_rollups` table on a schedule:

```sql
CREATE TABLE stats_rollups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  period      TEXT NOT NULL,     -- 'month:2026-03', 'year:2026', 'alltime'
  media_type  TEXT NOT NULL,     -- 'all', 'movie', 'episode', etc.
  stats       TEXT NOT NULL,     -- JSON blob (same ComputedStats shape)
  computed_at INTEGER NOT NULL,
  UNIQUE(user_id, period, media_type)
);
```

Scheduler rebuilds: monthly every 2 hours, yearly every 6 hours, alltime every 12 hours. Much lighter than current approach since it only covers long-range periods.

---

## Social/Presence Integration

The session poller currently calls `updateActivityPresence()` when sessions start/stop. This behavior is preserved — the calls just happen alongside DB writes instead of event emissions.

```typescript
// On session open:
updateActivityPresence(userId, { mediaId, mediaType, mediaTitle, serviceId, deviceName, clientName });

// On session close:
updateActivityPresence(userId, null);
```

---

## Files Changed

### Core (rewritten)

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | Add `playSessions`, `mediaActions`, `statsRollups`. Remove `mediaEvents`, `userStatsCache` |
| `src/lib/db/index.ts` | Update `initDb()`: create new tables, drop old ones |
| `src/lib/server/session-poller.ts` | Write to `play_sessions` instead of emitting events. Track `sessionDbId` in memory. Add stale session cleanup. Use `session_key` for crash recovery |
| `src/lib/server/stats-engine.ts` | Query `play_sessions` + `media_actions` directly. Remove all dedup logic. `getActiveUserIds()` queries `play_sessions` instead of `media_events` |
| `src/lib/server/stats-scheduler.ts` | Only rebuild monthly/yearly/alltime rollups. Remove daily/weekly rebuilds |
| `src/lib/server/analytics.ts` | Remove `emitMediaEvent`, `emitMediaEventsBatch`, `queryMediaEvents`, `countMediaEvents`. Add `emitMediaAction()` for non-playback events. Keep interaction event functions and webhook/poller registries unchanged |
| `src/routes/api/ingest/webhook/[serviceType]/+server.ts` | Webhook writes to `media_actions` for non-playback events, enriches open sessions for playback events |

### Progress endpoints (stop emitting events)

| File | Changes |
|------|---------|
| `src/routes/api/stream/[serviceId]/progress/+server.ts` | Remove `emitMediaEvent()` call. Keep `activity` table update for UI progress bars |
| `src/routes/api/video/progress/+server.ts` | Remove `emitMediaEvent()` call |
| `src/routes/api/books/[id]/progress/+server.ts` | Convert from `emitMediaEvent()` to creating/updating `play_sessions` rows (book session writer) |

### Stats/activity API consumers

| File | Changes |
|------|---------|
| `src/routes/api/user/stats/+server.ts` | Use new `computeStats()` signature |
| `src/routes/api/user/stats/timeline/+server.ts` | Query `play_sessions` for daily timeline |
| `src/routes/api/user/stats/top/+server.ts` | Query `play_sessions` for top items |
| `src/routes/api/user/stats/wrapped/+server.ts` | Query `play_sessions` for wrapped data |
| `src/routes/api/user/stats/live/+server.ts` | Query open `play_sessions` (endedAt IS NULL) |
| `src/routes/api/user/stats/events/+server.ts` | Query `play_sessions` + `media_actions` |
| `src/routes/api/user/play-history/+server.ts` | Query `play_sessions` instead of `media_events` |
| `src/routes/activity/+page.server.ts` | Updated data loading |
| `src/routes/activity/insights/+page.server.ts` | Updated timeline/calendar queries |
| `src/routes/activity/history/+page.server.ts` | Query `play_sessions` for history feed |

### Admin endpoints

| File | Changes |
|------|---------|
| `src/routes/api/admin/stats/+server.ts` | Use new stats queries against `play_sessions` |
| `src/routes/api/admin/stats/timeline/+server.ts` | Query `play_sessions` instead of `media_events` |
| `src/routes/api/admin/stats/users/+server.ts` | Query `play_sessions` instead of `media_events` |
| `src/routes/api/admin/content/+server.ts` | Query `play_sessions` instead of `media_events` |
| `src/routes/api/admin/system/+server.ts` | Update table list references |
| `src/routes/admin/+page.server.ts` | Update any `media_events` references |
| `src/lib/components/admin/AdminSystem.svelte` | Update `user_stats_cache` references to `stats_rollups` |

### Recommendation engine (queries `media_events`)

| File | Changes |
|------|---------|
| `src/lib/server/recommendations/providers/content-based.ts` | Rewrite SQL: `media_events` → `play_sessions` for genre affinity, watch history, year preferences |
| `src/lib/server/recommendations/providers/social.ts` | Rewrite SQL: `media_events` → `play_sessions` for user watch overlap |
| `src/lib/server/recommendations/providers/collaborative.ts` | Rewrite SQL: `media_events` → `play_sessions` for collaborative filtering |
| `src/lib/server/recommendations/providers/trending.ts` | Rewrite SQL: `media_events` → `play_sessions` for trending items |
| `src/lib/server/recommendations/providers/time-aware.ts` | Rewrite SQL: `media_events` → `play_sessions` for time-of-day patterns |
| `src/lib/server/rec-scheduler.ts` | `getActiveUserIds` or similar: query `play_sessions` instead of `media_events` |

### Other callers of `emitMediaEvent()`

| File | Changes |
|------|---------|
| `src/lib/server/ratings.ts` | Switch `emitMediaEvent()` → `emitMediaAction()` for rate/unrate |
| `src/lib/server/music.ts` | Query `play_sessions` instead of `media_events` for recently played |
| `src/routes/media/[type]/[id]/+page.server.ts` | Switch `emitMediaEvent()` → `emitMediaAction()` for detail_view |
| `src/routes/api/search/suggestions/+server.ts` | Query `play_sessions` instead of `media_events` for search suggestions |

### No changes needed

| File | Reason |
|------|--------|
| `src/lib/components/charts/*.svelte` | Consume `ComputedStats` interface — shape preserved |
| `src/hooks.server.ts` | Still starts poller + scheduler, no direct `media_events` reference |

---

## Migration

### Database migration steps

1. Create `play_sessions` table with indexes
2. Create `media_actions` table with index
3. Create `stats_rollups` table
4. Drop `media_events` table
5. Drop `user_stats_cache` table

This runs as part of the existing `initDb()` flow in `src/lib/db/index.ts`.

### Data migration

None. Clean slate per user decision. Old `media_events` data is dropped.

---

## Recommendation Engine Impact

Five recommendation provider files contain raw SQL against `media_events`. All need mechanical rewrites:

### Column mapping

| Old (`media_events`) | New (`play_sessions`) | Notes |
|---|---|---|
| `event_type = 'play_stop'` | (all rows are sessions) | No filter needed — every row is a completed or in-progress session |
| `play_duration_ms` | `duration_ms` | Rename |
| `duration_ticks` | `media_duration_ms` | Already in ms, no `/10000` conversion needed |
| `timestamp` | `started_at` | For time-range filtering |
| `ingested_at` | `created_at` | Rarely used, but available |

### Query pattern changes

- **"User watched X"** = session exists for that media_id
- **"User watched X for Y minutes"** = `SUM(duration_ms)` for that media_id
- **"User completed X"** = `completed = 1`
- **"User's top genres"** = `SUM(duration_ms)` grouped by parsed `media_genres` JSON
- **"Trending items"** = `COUNT(*)` or `SUM(duration_ms)` grouped by media_id, filtered by recent `started_at`
- **"Users who watched X also watched Y"** = join `play_sessions` on media_id across users

The `user_genre_affinity` table rebuild in `content-based.ts` needs the same column mapping. The `rec-scheduler.ts` `getActiveUserIds` equivalent needs to query `SELECT DISTINCT user_id FROM play_sessions`.

---

## Out of Scope (v1)

- Migrating `book_reading_sessions` into `play_sessions` (works fine as-is, can unify later)
- Music session tracking (Jellyfin audio already handled by poller; dedicated music services like Lidarr are future work)
- Retroactive data recovery from old `media_events` (data quality too poor)
- Client-side session tracking (e.g., tracking in-browser book reading) — future enhancement
