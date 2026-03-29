# Leveraging *arr API Features

**Date:** 2026-03-29
**Status:** Draft
**Goal:** Maximize use of Radarr, Sonarr, Lidarr, Prowlarr, Bazarr, and Overseerr APIs to provide calendar, quality badges, discovery, collections, credits, subtitle management, health monitoring, issue reporting, and admin search triggers.

## Architecture

Every feature follows the same pattern:

1. **Adapter method** — calls the *arr API, returns a Nexus unified type
2. **API route** — exposes via `/api/...`, handles caching with `withCache`
3. **UI component** — renders it (badge, row, panel, modal, page)

Most features map to adapter interface methods added in the consolidation spec:
- `getCalendar()` — new method (only addition to interface)
- `enrichItem()` — quality badges, subtitle status
- `getQueue()` — download queue (already exists, expand implementations)
- `discover()` — Overseerr discovery (already exists, expand)
- `getSubItems()` — collections
- `getServiceData()` — person/credits, health, commands
- `setItemStatus()` — subtitle actions, issue creation

## Phase 1: Calendar, Quality Badges, Download Queue

### 1.1 Calendar Aggregation

**New adapter method:**
```typescript
getCalendar?(config: ServiceConfig, start: string, end: string,
  userCred?: UserCredential): Promise<CalendarItem[]>;
```

`CalendarItem` (already defined in `types.ts`):
```typescript
interface CalendarItem {
  id: string;
  sourceId: string;
  serviceId: string;
  title: string;
  mediaType: MediaType;
  releaseDate: string;        // ISO date
  poster?: string;
  overview?: string;
  status?: 'upcoming' | 'released' | 'downloading';
}
```

**Radarr implementation:**
- `GET /api/v3/calendar?start={iso}&end={iso}&unmonitored=false`
- Response: array of movie objects with `inCinemas`, `physicalRelease`, `digitalRelease` dates
- Map: `title` = movie.title, `releaseDate` = earliest upcoming date, `poster` = movie.images[0].remoteUrl, `status` = hasFile ? 'released' : 'upcoming'

**Sonarr implementation:**
- `GET /api/v3/calendar?start={iso}&end={iso}&includeSeries=true&includeEpisodeFile=true`
- Response: array of episode objects with `airDateUtc`, series info
- Map: `title` = "Series S01E02 - Episode Title", `releaseDate` = airDateUtc, `mediaType` = 'show'

**Lidarr implementation:**
- `GET /api/v1/calendar?start={iso}&end={iso}&unmonitored=false`
- Response: array of album objects with `releaseDate`
- Map: `title` = "Artist - Album", `mediaType` = 'music'

**API route:** `GET /api/calendar?days=7&types=movie,show,music`
- Aggregates from all services implementing `getCalendar`
- Sorted by `releaseDate` ascending
- Cache: 5 min TTL

**UI:**
- Homepage "Coming This Week" row (auto-generated, slotted after continue watching)
- `/calendar` page: week view (default) and month view toggle
- Calendar items link to media detail page if available, or Overseerr request if not

### 1.2 Quality Badges

**Uses `enrichItem()` with `enrichmentType: 'quality'`.**

Adapters add quality metadata to `item.metadata.quality`:
```typescript
interface QualityInfo {
  resolution?: string;          // '4K', '1080p', '720p', '480p'
  hdr?: string;                 // 'DV' (Dolby Vision), 'HDR10+', 'HDR10', 'HLG'
  audioFormat?: string;         // 'Atmos', 'DTS-X', 'TrueHD', 'DTS-HD MA', 'FLAC', 'AAC'
  audioChannels?: string;       // '7.1', '5.1', '2.0'
  videoCodec?: string;          // 'HEVC', 'AV1', 'AVC'
  source?: string;              // 'Remux', 'Blu-ray', 'WEB-DL', 'HDTV'
  customFormats?: string[];     // from *arr custom format tags
  qualityProfile?: string;      // profile name (e.g. 'Ultra-HD', 'Any')
}
```

**Radarr implementation:**
- Movie file quality: already in `GET /api/v3/movie/{id}` response (`movieFile.quality`, `movieFile.mediaInfo`)
- `movieFile.mediaInfo.videoCodec`, `.videoBitDepth`, `.videoHdrFormat` → resolution, hdr, videoCodec
- `movieFile.mediaInfo.audioCodec`, `.audioChannels` → audioFormat, audioChannels
- Quality profiles: `GET /api/v3/qualityprofile` — cache 30 min
- Custom formats: `GET /api/v3/customformat` — cache 30 min
- Match custom format IDs on the movie to format names

**Sonarr implementation:**
- Same pattern: `episodeFile.quality`, `episodeFile.mediaInfo`
- Quality profiles: `GET /api/v3/qualityprofile`
- Custom formats: `GET /api/v3/customformat`

**Lidarr implementation:**
- `trackFile.quality` for audio quality (FLAC, MP3 320, etc.)
- Quality profiles: `GET /api/v1/qualityprofile`
- Map: `audioFormat` = 'FLAC'/'MP3 320'/'AAC', no video fields

**UI:**
- Small pill badges on media cards: "4K" "HDR" "Atmos" with distinct colors
- Media detail page: quality section showing full breakdown
- Badge rendering component: `QualityBadge.svelte` — takes `QualityInfo`, renders relevant pills
- Only show badges when data is available (graceful degradation)
- Cache: Quality profiles/custom formats 30 min, per-item enrichment 5 min

### 1.3 Download Queue Dashboard

**Uses `getQueue()` (already on interface).**

Expand queue item normalization to include:
```typescript
interface QueueItem extends UnifiedMedia {
  metadata: {
    queueStatus: 'downloading' | 'paused' | 'queued' | 'failed' | 'warning' | 'completed';
    downloadProgress: number;    // 0-100
    sizeBytes?: number;
    remainingBytes?: number;
    eta?: string;                // ISO timestamp
    downloadClient?: string;
    indexer?: string;
    quality?: string;
    errorMessage?: string;
  };
}
```

**Radarr implementation:**
- `GET /api/v3/queue?page=1&pageSize=50&includeUnknownMovieItems=true&includeMovie=true`
- Response includes: title, status, progress, size, ETA, download client, quality
- `GET /api/v3/queue/status` — overall queue health (errors, warnings, unknowns)

**Sonarr implementation:**
- `GET /api/v3/queue?page=1&pageSize=50&includeSeries=true&includeEpisode=true`
- Same fields as Radarr

**Lidarr implementation (new):**
- `GET /api/v1/queue?page=1&pageSize=50&includeAlbum=true&includeArtist=true`
- Add `getQueue()` to lidarr adapter

**API route:** `GET /api/admin/downloads?status=all|active|failed`
- Aggregates across all services with `getQueue`
- Sorted by: failed first, then by progress descending
- Cache: 10s TTL

**Admin actions via `getServiceData(dataType: 'command')`:**
- Retry failed: `POST /api/v3/queue/{id}/retry` (Radarr/Sonarr)
- Remove from queue: `DELETE /api/v3/queue/{id}?removeFromClient=true&blocklist=false`
- Blocklist and remove: `DELETE /api/v3/queue/{id}?removeFromClient=true&blocklist=true`

**API route:** `POST /api/admin/downloads/{serviceId}/{queueId}/action`
- Actions: `retry`, `remove`, `blocklist`

**UI:**
- Admin dashboard "Downloads" panel: table with progress bars, ETA, status icons
- Failed downloads highlighted red with retry/remove/blocklist buttons
- Auto-refresh every 10s (polling or WebSocket if available)
- Badge on admin nav showing active download count

## Phase 2: Overseerr Discovery, Collections, Credits/Cast

### 2.1 Overseerr Discovery

**Uses `discover()` (already on interface). Expand Overseerr adapter implementation.**

**New Overseerr adapter methods/expansion:**

Discovery categories:
- `GET /api/v1/discover/movies` — trending movies
- `GET /api/v1/discover/movies/upcoming` — upcoming movies
- `GET /api/v1/discover/tv` — trending TV
- `GET /api/v1/discover/tv/upcoming` — upcoming shows
- `GET /api/v1/discover/trending` — combined trending (movies + TV)
- `GET /api/v1/discover/movies/genre/{genreId}` — by genre
- `GET /api/v1/discover/tv/network/{networkId}` — by network (Netflix, HBO, etc.)
- `GET /api/v1/discover/keyword/{keywordId}/movies` — by keyword

Genre/network lists for filters:
- `GET /api/v1/genres/movie` — movie genres with IDs
- `GET /api/v1/genres/tv` — TV genres with IDs
- Cache: 1 hour (genres don't change)

Recommendation endpoints:
- `GET /api/v1/movie/{tmdbId}/recommendations` — TMDB recommendations
- `GET /api/v1/movie/{tmdbId}/similar` — TMDB similar movies
- `GET /api/v1/tv/{tmdbId}/recommendations` — same for TV
- `GET /api/v1/tv/{tmdbId}/similar` — same for TV

All discovery results include: TMDB ID, title, overview, poster, backdrop, vote average, release date, genres, media info (request status if requested in Overseerr).

**API routes:**
- `GET /api/discover?category=trending|upcoming|genre|network&type=movie|tv&genreId=...&networkId=...&page=...`
- `GET /api/media/{type}/{tmdbId}/recommendations`
- `GET /api/media/{type}/{tmdbId}/similar`

**UI:**
- `/discover` page: tabbed categories (Trending, Upcoming, By Genre, By Network)
- Genre/network filter dropdowns
- Infinite scroll pagination
- Each item shows request status badge (available/requested/not requested)
- "Request" button on items not yet in library
- Media detail page: "Recommended" and "Similar" rows at bottom
- Homepage: "Upcoming Movies" and "Upcoming Shows" rows (from discovery, not calendar — these are TMDB-sourced, broader than what's monitored)
- Cache: 15 min for discovery pages, 30 min for recommendations

### 2.2 Collections/Franchises

**Uses `getSubItems()` with `type: 'collection'`.**

**Radarr implementation:**
- `GET /api/v3/collection` — all TMDB collections with movies
- Response: array of `{ id, title, tmdbId, movies: [...], images: [...] }`
- Each movie includes availability status (hasFile, monitored)
- Normalize: collection name, poster (from images), movies as `UnifiedMedia[]` with availability

**Overseerr implementation:**
- `GET /api/v1/collection/{tmdbId}` — single collection detail
- Includes full movie details with request status
- Used for collection detail page when Radarr doesn't have the collection

**API routes:**
- `GET /api/collections` — list all collections from Radarr
- `GET /api/collections/{tmdbId}` — collection detail (Radarr + Overseerr fallback)

**UI:**
- Media detail page: "Part of {Collection Name}" banner with poster grid of other movies
- `/collections` browse page: grid of collection posters
- Collection detail page: hero + movie grid with availability badges
- Cache: 30 min TTL

### 2.3 Credits/Cast via Overseerr

**Uses `getServiceData()` with `dataType: 'person'`.**

**Overseerr implementation:**
- `GET /api/v1/person/{personId}` — bio, profile image, known-for department, birthday, place of birth, also known as
- `GET /api/v1/person/{personId}/combined_credits` — full filmography (cast + crew roles across movies + TV)
- `GET /api/v1/search/person?query=...&page=1` — person search

Normalize credits to `UnifiedMedia[]` with role info in metadata:
```typescript
{
  metadata: {
    role: 'Tony Stark / Iron Man',   // for cast
    job: 'Director',                  // for crew
    department: 'Directing',
    creditType: 'cast' | 'crew'
  }
}
```

**API routes:**
- `GET /api/person/{personId}` — person detail
- `GET /api/person/{personId}/credits` — filmography
- `GET /api/search/person?query=...` — person search

**UI:**
- Media detail page: cast section already exists — make names clickable
- Person detail page: `/person/{id}` — hero with photo/bio, filmography grid
- Filmography sorted by popularity, grouped by department (Acting, Directing, Writing)
- Each filmography item shows availability badge + request button
- "More from this Director" row on media detail pages
- Cache: 1 hour for person data, 30 min for credits

## Phase 3: Subtitle Management, Health Dashboard, Issue Reporting, Search Triggers

### 3.1 Subtitle Management from Player

**Status uses `enrichItem()` (already implemented). Actions use new adapter methods.**

**Bazarr adapter — new action methods:**

Download subtitle:
- `PATCH /api/movies/subtitles` with `{ id: radarrId, language, hi, forced, provider }` — download for movie
- `PATCH /api/episodes/subtitles` with `{ id: sonarrEpisodeId, language, hi, forced, provider }` — download for episode
- Map to `setItemStatus(sourceId, { action: 'download-subtitle', language, hi, forced, provider })`

Upload subtitle:
- `POST /api/movies/subtitles` with multipart form (file, language, forced, hi)
- `POST /api/episodes/subtitles` with multipart form
- Map to `uploadContent(sourceId, 'subtitle', blob, fileName)`

Delete subtitle:
- `DELETE /api/movies/subtitles` with `{ id, language, path }`
- `DELETE /api/episodes/subtitles` with `{ id, language, path }`
- Map to `setItemStatus(sourceId, { action: 'delete-subtitle', language, path })`

Sync timing:
- `PATCH /api/subtitles` with `{ action: 'sync', language, path, mediaType, id }` — Golden-Section Search algorithm
- Map to `setItemStatus(sourceId, { action: 'sync-subtitle', language, path })`

Translate:
- `PATCH /api/subtitles` with `{ action: 'translate', language, path, mediaType, id }` — translate to target language
- Map to `setItemStatus(sourceId, { action: 'translate-subtitle', language, targetLanguage, path })`

Provider management (admin):
- `GET /api/providers` — provider list with status (active/throttled, number of timeouts)
- `POST /api/providers` with `{ action: 'reset' }` — reset throttled providers
- `GET /api/badges` — counts: missing movie subs, missing episode subs, throttled providers, health issues

**API routes:**
- `POST /api/subtitles/download` — `{ serviceId, itemId, language, hi?, forced?, provider? }`
- `POST /api/subtitles/upload` — multipart form with `serviceId, itemId, language, file`
- `POST /api/subtitles/sync` — `{ serviceId, itemId, language, path }`
- `POST /api/subtitles/translate` — `{ serviceId, itemId, language, targetLanguage, path }`
- `DELETE /api/subtitles` — `{ serviceId, itemId, language, path }`
- `GET /api/admin/subtitles/providers` — provider status
- `POST /api/admin/subtitles/providers/reset` — reset throttled

**UI:**
- Player subtitle picker: adds "Download More", "Upload", "Sync Timing", "Translate" action buttons
- "Download More" opens modal: language picker + provider selector + HI/forced toggles
- "Sync Timing" one-click action with toast feedback
- Media detail page: subtitle status badge (green = all good, yellow = some missing, red = missing wanted)
- Admin panel: subtitle provider health widget with reset button
- Admin badge: missing subtitle count

### 3.2 Health Aggregation Dashboard

**Uses `getServiceData()` with `dataType: 'health'`.**

**Implementation per adapter:**

Radarr/Sonarr:
- `GET /api/v3/health` — array of `{ source, type: 'notice'|'warning'|'error', message, wikiUrl }`
- `GET /api/v3/diskspace` — array of `{ path, label, freeSpace, totalSpace }`
- `GET /api/v3/system/status` — version, OS, runtime, migration status

Lidarr:
- `GET /api/v1/health` — same format as Radarr
- `GET /api/v1/diskspace` — same format
- `GET /api/v1/system/status` — same format

Prowlarr:
- `GET /api/v1/health` — same format
- `GET /api/v1/indexerstatus` — per-indexer health with error details, disabled until timestamps
- `GET /api/v1/system/status` — version info

Bazarr:
- `GET /api/badges` — `{ episodes, movies, providers, status }` counts
- `GET /api/providers` — provider list with throttle status

Normalize to:
```typescript
interface HealthReport {
  serviceId: string;
  serviceName: string;
  serviceType: string;
  version?: string;
  status: 'healthy' | 'warning' | 'error';
  issues: Array<{
    type: 'notice' | 'warning' | 'error';
    message: string;
    wikiUrl?: string;
    source?: string;
  }>;
  storage?: Array<{
    path: string;
    label?: string;
    freeBytes: number;
    totalBytes: number;
    percentUsed: number;
  }>;
}
```

**API route:** `GET /api/admin/health`
- Aggregates from all services
- Includes Nexus's own health (DB size, uptime, memory)
- Cache: 30s TTL

**UI:**
- Admin dashboard "System Health" panel
- Service cards: green/yellow/red status dot, expandable issue list
- Storage bars: visual percentage with color coding (green < 80%, yellow < 90%, red >= 90%)
- Per-issue wiki links open in new tab
- Auto-refresh every 30s
- Prowlarr section: indexer status table (name, status, last query, error count)

### 3.3 Issue Reporting via Overseerr

**Uses `getServiceData()` + `setItemStatus()`.**

**Overseerr adapter implementation:**

List issues:
- `GET /api/v1/issue?take=20&skip=0&sort=created&filter=open` — open issues
- `GET /api/v1/issue?filter=all` — all issues
- `GET /api/v1/issue/count` — `{ video, audio, subtitle, other, total }`

Create issue:
- `POST /api/v1/issue` — `{ issueType: 1|2|3|4, message, mediaId }`
  - 1 = video quality, 2 = audio quality, 3 = subtitles, 4 = other

Issue detail:
- `GET /api/v1/issue/{id}` — full issue with comments
- `POST /api/v1/issue/{id}/comment` — add comment `{ message }`
- `POST /api/v1/issue/{id}/approved` — mark resolved (admin)
- `POST /api/v1/issue/{id}/declined` — mark declined (admin)

**API routes:**
- `GET /api/issues?filter=open|all&page=1` — list issues
- `GET /api/issues/count` — counts by type
- `POST /api/issues` — create `{ serviceId, mediaId, issueType, message }`
- `GET /api/issues/{id}` — detail with comments
- `POST /api/issues/{id}/comment` — `{ message }`
- `POST /api/issues/{id}/resolve` — admin resolve
- `POST /api/issues/{id}/decline` — admin decline

**UI:**
- Media detail page: "Report a Problem" button → modal with type picker (Video/Audio/Subtitle/Other) + message textarea
- Admin dashboard: "Issues" panel with count badge + list
- Issue detail: conversation thread with resolve/decline buttons for admin
- Toast confirmation on issue submission
- Cache: 30s for lists, no cache for mutations

### 3.4 Direct Search Triggers

**Uses `getServiceData()` with `dataType: 'command'`.**

**Per-adapter commands:**

Radarr:
- `POST /api/v3/command` with `{ name: 'MoviesSearch', movieIds: [id] }` — search for movie release
- `POST /api/v3/command` with `{ name: 'RssSync' }` — trigger RSS sync
- `POST /api/v3/command` with `{ name: 'RefreshMovie', movieIds: [id] }` — refresh metadata
- `POST /api/v3/command` with `{ name: 'MissingMoviesSearch' }` — search all missing
- `GET /api/v3/command` — list running/queued commands

Sonarr:
- `POST /api/v3/command` with `{ name: 'EpisodeSearch', episodeIds: [id] }` — search for episode
- `POST /api/v3/command` with `{ name: 'SeasonSearch', seriesId, seasonNumber }` — search full season
- `POST /api/v3/command` with `{ name: 'SeriesSearch', seriesId }` — search all episodes
- `POST /api/v3/command` with `{ name: 'RssSync' }` — trigger RSS sync
- `POST /api/v3/command` with `{ name: 'RefreshSeries', seriesId }` — refresh metadata
- `POST /api/v3/command` with `{ name: 'MissingEpisodeSearch' }` — search all missing

Lidarr:
- `POST /api/v1/command` with `{ name: 'AlbumSearch', albumIds: [id] }` — search for album
- `POST /api/v1/command` with `{ name: 'ArtistSearch', artistId }` — search all by artist
- `POST /api/v1/command` with `{ name: 'MissingAlbumSearch' }` — search all missing
- `POST /api/v1/command` with `{ name: 'RssSync' }` — RSS sync

Bazarr:
- `PATCH /api/movies` with `{ action: 'search-missing', radarrid: id }` — search missing movie subs
- `PATCH /api/episodes` with `{ action: 'search-missing', seriesid, episodeid }` — search missing episode subs

**API route:** `POST /api/admin/command`
```typescript
{
  serviceId: string;
  command: string;        // 'search', 'rss-sync', 'refresh', 'search-missing', 'search-subtitles'
  params?: {
    mediaId?: string;     // movie/series/album ID
    seasonNumber?: number;
    episodeId?: string;
  };
}
```
- Returns: `{ commandId, status: 'queued' | 'started' }`
- Admin-only (check `locals.user.isAdmin`)

**API route:** `GET /api/admin/command/{serviceId}` — list active/recent commands

**UI:**
- Media detail page (admin only): "Search for Release" dropdown with options per service type
- Admin dashboard: "Search All Missing" button per service
- Admin dashboard: "RSS Sync All" button
- Command feedback: toast with "Search queued" → poll for completion
- Cache: none (mutations)

## Caching Strategy Summary

| Data | TTL | Reason |
|------|-----|--------|
| Calendar | 5 min | Releases change infrequently |
| Quality profiles + custom formats | 30 min | Configuration data, rarely changes |
| Per-item quality enrichment | 5 min | May change after upgrade/replacement |
| Download queue | 10s | Downloads progress rapidly |
| Discovery pages | 15 min | TMDB data, updated periodically |
| Recommendations/similar | 30 min | Stable per-item data |
| Collections | 30 min | Rarely changes |
| Person/credits | 1 hour | Very stable biographical data |
| Genre/network lists | 1 hour | Static reference data |
| Subtitle status | 2 min | May change after download/sync |
| Health reports | 30s | Operational monitoring |
| Issue lists | 30s | User-facing, should feel fresh |
| Commands | none | Mutations, no caching |

## Success Criteria

After all 3 phases:
- Users see upcoming releases across all monitored media types on the homepage
- Media cards display quality badges (4K, HDR, Atmos, FLAC) when data is available
- Admins can monitor and manage downloads from Nexus without opening *arr UIs
- Users can discover new content via TMDB-powered categories, genres, and networks
- Franchise/collection browsing available on movie detail pages
- Clickable cast leads to person pages with full filmographies
- Users can download, upload, sync, and translate subtitles from the player
- Admins see unified health status across all services with storage monitoring
- Users can report issues directly from media detail pages
- Admins can trigger searches and RSS syncs from Nexus
