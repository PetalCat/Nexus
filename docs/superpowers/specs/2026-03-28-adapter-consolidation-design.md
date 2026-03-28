# Adapter Layer Consolidation

**Date:** 2026-03-28
**Status:** Draft
**Goal:** Make Nexus adapter-agnostic so contributors can add new services without modifying server code.

## Problem

Nexus has a well-designed adapter registry, but generic server code bypasses it extensively:

- **97 hardcoded service type checks** across 52 files (e.g. `if (config.type === 'jellyfin')`)
- **55 files** import adapter functions directly instead of using the registry
- **940 lines** of adapter-specific logic embedded in generic server code
- **76 exported functions** across adapters that bypass the `ServiceAdapter` interface

A contributor adding a new service today must modify `services.ts`, `session-poller.ts`, `media-sync.ts`, image proxy routes, and domain route files. The adapter pattern should make this unnecessary.

## Principle

**Nexus defines what it wants. Adapters figure out how to get it.**

Nexus works with unified types and capability queries. Adapters handle all service-specific API calls, auth, and data translation. A new adapter is one file + one registry line.

## Design

### 1. Capability Metadata

Replace hardcoded service type sets with declarative adapter metadata.

**Current problem — `services.ts`:**
```typescript
const LIBRARY_TYPES = new Set(['jellyfin', 'calibre', 'romm', 'invidious']);
const excludeFromSearch = new Set(['invidious', 'prowlarr', 'streamystats', 'bazarr']);
const priority = { jellyfin: 0, calibre: 0, romm: 0, overseerr: 1, lidarr: 2, radarr: 3, sonarr: 3 };
```

**New fields on `ServiceAdapter`:**

| Field | Type | Purpose | Replaces |
|-------|------|---------|----------|
| `isLibrary` | `boolean?` | Has browsable media content | `LIBRARY_TYPES` set |
| `isSearchable` | `boolean?` | Should appear in unified search | `excludeFromSearch` set |
| `searchPriority` | `number?` | 0 = highest priority in results | `priority` map |
| `authVia` | `string?` | Delegates auth to another adapter (e.g. `'jellyfin'`) | StreamyStats/Overseerr special cases in `resolveUserCred` |
| `isEnrichmentOnly` | `boolean?` | No user-facing content (Bazarr, Prowlarr) | Various exclusion checks |

**Domain route filtering:** Routes like `/videos/` currently check `c.type === 'invidious'`. These should filter by `adapter.mediaTypes` (which already exists on the interface). A `/videos/` route filters for adapters with `mediaTypes` containing `'video'`, not a hardcoded service name.

**Values for existing adapters:**

| Adapter | isLibrary | isSearchable | searchPriority | authVia | isEnrichmentOnly |
|---------|-----------|-------------|----------------|---------|-----------------|
| jellyfin | true | true | 0 | — | — |
| calibre | true | true | 0 | — | — |
| romm | true | true | 0 | — | — |
| invidious | true | true | 0 | — | — |
| overseerr | — | true | 1 | jellyfin | — |
| lidarr | — | true | 2 | — | — |
| radarr | — | true | 3 | — | — |
| sonarr | — | true | 3 | — | — |
| streamystats | — | — | — | jellyfin | — |
| bazarr | — | — | — | — | true |
| prowlarr | — | — | — | — | true |

### 2. Extended Interface Methods

76 exported adapter functions fall into 5 categories. Four get standardized interface methods; one stays as-is.

#### 2a. Browse Extensions (14 functions → 4 methods)

```typescript
/** Sub-items: seasons, albums, tracks, platforms, collections */
getSubItems?(config: ServiceConfig, parentId: string, type: string,
  opts?: { limit?: number; offset?: number; sort?: string },
  userCred?: UserCredential): Promise<{ items: UnifiedMedia[]; total: number }>;

/** Detail for a child item: album tracks, season episodes */
getSubItemDetail?(config: ServiceConfig, parentId: string, childId: string,
  userCred?: UserCredential): Promise<UnifiedMedia[]>;

/** Related items: same-author books, instant mix, similar games */
getRelated?(config: ServiceConfig, sourceId: string,
  userCred?: UserCredential): Promise<UnifiedMedia[]>;

/** Browsing categories: genres, tags, platforms, authors */
getCategories?(config: ServiceConfig,
  userCred?: UserCredential): Promise<Array<{ id: string; name: string; count?: number; image?: string }>>;
```

**Migration mapping:**

| Current export | Adapter | New method | `type` param |
|---------------|---------|------------|-------------|
| `getSeasons(seriesId)` | jellyfin | `getSubItems(parentId, 'season')` | `'season'` |
| `getAlbums(opts)` | jellyfin | `getSubItems(parentId, 'album')` | `'album'` |
| `getArtists(opts)` | jellyfin | `getCategories()` | — |
| `getAlbumTracks(albumId)` | jellyfin | `getSubItemDetail(albumId, 'tracks')` | — |
| `getArtistAlbums(artistId)` | jellyfin | `getSubItems(artistId, 'album')` | `'album'` |
| `getSongs(opts)` | jellyfin | `getSubItems(parentId, 'song')` | `'song'` |
| `getInstantMix(itemId)` | jellyfin | `getRelated(sourceId)` | — |
| `getPlatforms()` | romm | `getCategories()` | — |
| `getCollections()` | romm | `getSubItems(null, 'collection')` | `'collection'` |
| `getCollection(id)` | romm | `getSubItemDetail(null, collectionId)` | — |
| `getLidarrArtists()` | lidarr | `getCategories()` | — |
| `getLidarrAlbums(artistId?)` | lidarr | `getSubItems(artistId, 'album')` | `'album'` |
| `getLidarrWanted(opts)` | lidarr | `getSubItems(null, 'wanted')` | `'wanted'` |
| `getTrendingByCategory(cat)` | invidious | `getTrending()` with category in opts | — |

#### 2b. User Actions (18 functions → 4 methods)

```typescript
/** Set status: read/unread, favorite, watched, playing/completed */
setItemStatus?(config: ServiceConfig, sourceId: string,
  status: Record<string, unknown>, userCred?: UserCredential): Promise<void>;

/** Collection/playlist CRUD */
manageCollection?(config: ServiceConfig,
  action: 'create' | 'update' | 'delete' | 'addItems' | 'removeItems',
  data: { id?: string; name?: string; itemIds?: string[]; [key: string]: unknown },
  userCred?: UserCredential): Promise<{ id: string } | void>;

/** Channel/creator subscriptions */
manageSubscription?(config: ServiceConfig,
  action: 'subscribe' | 'unsubscribe',
  channelId: string, userCred?: UserCredential): Promise<void>;

/** Upload binary content (save states, save files) */
uploadContent?(config: ServiceConfig, parentId: string, type: string,
  blob: Blob, fileName: string, userCred?: UserCredential): Promise<void>;
```

**Migration mapping:**

| Current export | Adapter | New method |
|---------------|---------|------------|
| `toggleReadStatus(bookId)` | calibre | `setItemStatus(bookId, { read: true })` |
| `toggleRomFavorite(romId)` | romm | `setItemStatus(romId, { favorite: true })` |
| `updateUserRomStatus(romId, status)` | romm | `setItemStatus(romId, { playStatus: status })` |
| `markWatched(videoId)` | invidious | `setItemStatus(videoId, { watched: true })` |
| `removeFromHistory(videoId)` | invidious | `setItemStatus(videoId, { inHistory: false })` |
| `createCollection(name)` | romm | `manageCollection('create', { name })` |
| `updateCollection(id, data)` | romm | `manageCollection('update', { id, ...data })` |
| `deleteCollection(id)` | romm | `manageCollection('delete', { id })` |
| `updateCollectionRoms(id, romIds)` | romm | `manageCollection('addItems', { id, itemIds })` |
| `createPlaylist(title)` | invidious | `manageCollection('create', { name: title })` |
| `deletePlaylist(id)` | invidious | `manageCollection('delete', { id })` |
| `addToPlaylist(playlistId, videoId)` | invidious | `manageCollection('addItems', { id, itemIds: [videoId] })` |
| `removeFromPlaylist(playlistId, index)` | invidious | `manageCollection('removeItems', { id, itemIds: [index] })` |
| `subscribe(channelId)` | invidious | `manageSubscription('subscribe', channelId)` |
| `unsubscribe(channelId)` | invidious | `manageSubscription('unsubscribe', channelId)` |
| `uploadRomState(romId, blob, name)` | romm | `uploadContent(romId, 'state', blob, name)` |
| `uploadRomSave(romId, blob, name)` | romm | `uploadContent(romId, 'save', blob, name)` |
| `importJellyfinUser(...)` | overseerr | stays as admin-only direct import |

#### 2c. Binary Downloads (5 functions → 1 method)

```typescript
/** Download binary content (books, ROMs, save states) */
downloadContent?(config: ServiceConfig, sourceId: string,
  format?: string, userCred?: UserCredential): Promise<Response>;
```

**Migration mapping:**

| Current export | Adapter | `format` param |
|---------------|---------|---------------|
| `downloadBook(bookId, format)` | calibre | `'epub'`, `'pdf'`, etc. |
| `downloadRomContent(romId)` | romm | `undefined` (default) |
| `downloadRomState(romId, stateId)` | romm | `'state:${stateId}'` |
| `downloadRomSave(romId, saveId)` | romm | `'save:${saveId}'` |

#### 2d. Enrichment & Service Data (28 functions → 2 methods)

```typescript
/** Enrich an existing item with additional metadata from this service */
enrichItem?(config: ServiceConfig, item: UnifiedMedia,
  enrichmentType?: string, userCred?: UserCredential): Promise<UnifiedMedia>;

/** Fetch service-specific data that doesn't map to a UnifiedMedia item */
getServiceData?(config: ServiceConfig, dataType: string,
  params?: Record<string, unknown>,
  userCred?: UserCredential): Promise<unknown>;
```

`enrichItem` is for adding metadata to an existing item (subtitles, formats, saves). The adapter receives a `UnifiedMedia` and returns it with additional fields in `metadata`.

`getServiceData` is for fetching standalone data that doesn't attach to an item (subscriptions, playlists, channel info, search suggestions, TV guide). The `dataType` discriminator selects what to fetch; the return type is `unknown` and callers cast to the expected shape.

**`enrichItem` mapping (item-attached metadata):**

| Current export | Adapter | `enrichmentType` |
|---------------|---------|-----------------|
| `getSubtitleStatus(tmdbId)` | bazarr | `'subtitles'` |
| `getSeasonSubtitleStatus(seriesId, season)` | bazarr | `'season-subtitles'` |
| `getItemSubtitleHistory(tmdbId)` | bazarr | `'subtitle-history'` |
| `getCalibreBookFormats(bookId)` | calibre | `'formats'` |
| `getRelatedBooks(bookId)` | calibre | `'related'` |
| `getRomSaves(romId)` | romm | `'saves'` |
| `getRomStates(romId)` | romm | `'states'` |
| `getRomScreenshots(romId)` | romm | `'screenshots'` |
| `getStreamyStatsRecommendations(...)` | streamystats | `'recommendations'` |
| `getChannelPrograms(channelId)` | jellyfin | `'programs'` |

**`getServiceData` mapping (standalone data):**

| Current export | Adapter | `dataType` |
|---------------|---------|-----------|
| `getSubscriptions()` | invidious | `'subscriptions'` |
| `getSubscriptionFeed(page)` | invidious | `'subscription-feed'` |
| `getUserPlaylists()` | invidious | `'playlists'` |
| `getWatchHistory(page)` | invidious | `'watch-history'` |
| `getChannel(channelId)` | invidious | `'channel'` |
| `getChannelVideos(channelId)` | invidious | `'channel-videos'` |
| `getComments(videoId)` | invidious | `'comments'` |
| `getSearchSuggestions(query)` | invidious | `'search-suggestions'` |
| `getLiveTvGuide()` | jellyfin | `'tv-guide'` |
| `getCalibreSeries()` | calibre | `'series'` |
| `getCalibreAuthors()` | calibre | `'authors'` |
| `getCalibreCategories()` | calibre | `'categories'` |
| `getAllBooks()` | calibre | `'all'` |

#### 2e. Admin Operations (5 functions — no change)

These stay as direct exports from their adapter files. They're admin-only, low-frequency, and don't benefit from standardization:

- `getProwlarrIndexers()`, `getProwlarrStats()` — Prowlarr admin dashboard
- `getProviderStatus()`, `getLanguageProfiles()`, `getSystemHistory()` — Bazarr admin dashboard

Admin routes import these directly — acceptable coupling for admin-only code.

### 3. Session Polling

Replace 286 lines of embedded Jellyfin/RomM code in `session-poller.ts` with one adapter method.

**New method:**
```typescript
pollSessions?(config: ServiceConfig, userCred?: UserCredential): Promise<NexusSession[]>;
```

**New field:**
```typescript
pollIntervalMs?: number;  // adapter controls its own poll frequency (default: 10000)
```

**`NexusSession` type:**
```typescript
interface NexusSession {
  sessionId: string;
  userId?: string;
  username?: string;
  mediaId: string;
  mediaTitle: string;
  mediaType: MediaType;
  state: 'playing' | 'paused' | 'stopped';
  progress: number;              // 0-1
  positionSeconds?: number;
  durationSeconds?: number;
  device?: string;
  client?: string;
  metadata?: {
    resolution?: string;
    videoCodec?: string;
    audioCodec?: string;
    audioChannels?: number;
    hdr?: boolean;
    transcoding?: boolean;
    bitrate?: number;
  };
}
```

**What moves where:**

| Currently in session-poller.ts | Moves to |
|-------------------------------|----------|
| `JfSession` interface (29 lines) | jellyfin adapter (internal type) |
| `JF_TYPE_MAP` (7 lines) | jellyfin adapter (internal) |
| `extractMetadata()` (36 lines) | jellyfin adapter (internal) |
| `pollJellyfinSessions()` (167 lines) | `jellyfinAdapter.pollSessions()` |
| `pollRommStatuses()` (119 lines) | `rommAdapter.pollSessions()` |
| RomM poll throttling (skip 5/6) | `rommAdapter.pollIntervalMs = 60000` |

**session-poller.ts becomes ~40 lines:**
```
for each config with adapter.pollSessions:
  poll at adapter.pollIntervalMs interval
  diff against previous state
  emit play/pause/resume/stop events
```

### 4. Media Sync

Replace 169 lines of Jellyfin-only code in `media-sync.ts`.

**New method:**
```typescript
syncLibraryItems?(config: ServiceConfig, userCred?: UserCredential): Promise<SyncItem[]>;
```

**`SyncItem` type:**
```typescript
interface SyncItem {
  sourceId: string;
  title: string;
  sortTitle?: string;
  mediaType: MediaType;
  year?: number;
  genres?: string[];
  poster?: string;
  backdrop?: string;
  duration?: number;       // seconds
  rating?: number;
  tmdbId?: string;
  imdbId?: string;
}
```

**What moves where:**

| Currently in media-sync.ts | Moves to |
|---------------------------|----------|
| `JellyfinItem` interface (15 lines) | jellyfin adapter (internal type) |
| `jellyfinTypeToLocal()` (9 lines) | jellyfin adapter (internal) |
| `fetchJellyfinItems()` (32 lines) | jellyfin `syncLibraryItems()` |
| Jellyfin field mapping (47 lines) | jellyfin `syncLibraryItems()` |
| Image URL construction (6 lines) | jellyfin `syncLibraryItems()` |

**media-sync.ts becomes ~50 lines:**
```
for each config with adapter.syncLibraryItems:
  fetch items via adapter
  upsert into media_items table
```

The recommendation engine now gets data from all library services, not just Jellyfin.

### 5. Image Proxy Auth

Replace service-type branching in `/api/media/image/+server.ts`.

**New method:**
```typescript
getImageHeaders?(config: ServiceConfig, userCred?: UserCredential): Promise<Record<string, string>>;
```

**Current code (3 branches):**
```typescript
if (config.type === 'romm')     → Basic auth header
if (config.type === 'jellyfin') → X-Emby-Token header
if (config.type === 'calibre')  → session cookie
```

**After:** Each adapter implements `getImageHeaders()` returning whatever its image server needs. The proxy route becomes two lines.

### 6. Unified Types Summary

New types added to `src/lib/adapters/types.ts`:

```typescript
interface NexusSession { ... }   // Section 3
interface SyncItem { ... }       // Section 4
interface CalendarItem {         // For future *arr API spec
  id: string;
  sourceId: string;
  serviceId: string;
  title: string;
  mediaType: MediaType;
  releaseDate: string;           // ISO date
  poster?: string;
  overview?: string;
  status?: 'upcoming' | 'released' | 'downloading';
}
```

### 7. Migration Strategy

This is an incremental migration — no big-bang rewrite.

**Phase order:**
1. Add new fields and methods to `ServiceAdapter` interface (all optional, backward compatible)
2. Implement new methods on adapters one at a time
3. Update consumers to use capability flags + registry calls
4. Remove old direct imports and hardcoded type checks
5. Delete dead code from server files

Each adapter can be migrated independently. At no point does the system break — old code and new code coexist until the old path is removed.

**Priority order (by impact):**
1. Capability metadata — unblocks all other changes
2. Session polling — removes 286 lines, enables new session-capable adapters
3. Media sync — removes 169 lines, enables multi-service recommendations
4. Browse/action/download methods — removes 55 direct imports across many files
5. Image proxy auth — small change, easy win
6. Domain route `mediaTypes` filtering — large file count but mechanical changes

### 8. What Stays As-Is

- **Admin direct imports** — Prowlarr stats, Bazarr provider status (5 functions, admin-only)
- **Internal helpers** — `getSession` (Calibre), `normalizeVideo` (Invidious) — implementation details
- **Recommendation provider system** — already a clean separate plugin layer
- **`health-watchdog.ts`** — already service-agnostic
- **`stats-engine.ts`** — already service-agnostic
- **Adapter files themselves** — internal implementation stays unchanged, just wrapping existing logic in new interface methods

### 9. Success Criteria

After this work:
- A contributor can add a new service adapter in one file + one registry line
- No server code changes required for a new adapter
- `services.ts` has zero hardcoded service type strings
- `session-poller.ts` has zero adapter-specific API calls
- `media-sync.ts` has zero adapter-specific API calls
- Domain routes filter by `mediaTypes`, not service type strings
- All existing functionality works identically
