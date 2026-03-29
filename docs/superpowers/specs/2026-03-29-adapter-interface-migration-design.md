# Adapter Interface Migration — Route-Level Direct Imports

**Date:** 2026-03-29
**Status:** Draft
**Goal:** Replace ~57 direct adapter imports in route files with registry-based calls through the standardized interface methods added in the consolidation spec.

## Problem

Route files directly import adapter-specific functions:
```typescript
import { getPlatforms, getCollections } from '$lib/adapters/romm';
import { getWatchHistory, markWatched } from '$lib/adapters/invidious';
import { downloadBook } from '$lib/adapters/calibre';
```

This couples routes to specific adapters. A new adapter providing the same capability (e.g. a Plex adapter providing playlists) would require editing every route file.

## Approach

1. Implement the new interface methods on each adapter, wrapping existing exported functions
2. Migrate route files to use `registry.get(type)?.method()` instead of direct imports
3. Existing exports stay as internal helpers — no breaking changes during migration

## Migration by Adapter

### Invidious (21 route imports → 6 interface methods)

**`getServiceData(config, dataType, params, userCred)`** wrapping:

| `dataType` | Wraps | Params |
|-----------|-------|--------|
| `'subscriptions'` | `getSubscriptions(config, userCred)` | — |
| `'subscription-feed'` | `getSubscriptionFeed(config, page, userCred)` | `{ page }` |
| `'playlists'` | `getUserPlaylists(config, userCred)` | — |
| `'watch-history'` | `getWatchHistory(config, page, userCred)` | `{ page }` |
| `'channel'` | `getChannel(config, channelId)` | `{ channelId }` |
| `'channel-videos'` | `getChannelVideos(config, channelId, sort)` | `{ channelId, sort }` |
| `'comments'` | `getComments(config, videoId, sort)` | `{ videoId, sort }` |
| `'search-suggestions'` | `getSearchSuggestions(config, query)` | `{ query }` |

**`manageCollection(config, action, data, userCred)`** wrapping:

| Action | Wraps |
|--------|-------|
| `'create'` | `createPlaylist(config, data.name, data.privacy, userCred)` |
| `'delete'` | `deletePlaylist(config, data.id, userCred)` |
| `'addItems'` | `addToPlaylist(config, data.id, data.itemIds[0], userCred)` |
| `'removeItems'` | `removeFromPlaylist(config, data.id, data.itemIds[0], userCred)` |

**`manageSubscription(config, action, channelId, userCred)`** wrapping:

| Action | Wraps |
|--------|-------|
| `'subscribe'` | `subscribe(config, channelId, userCred)` |
| `'unsubscribe'` | `unsubscribe(config, channelId, userCred)` |

**`setItemStatus(config, sourceId, status, userCred)`** wrapping:

| Status key | Wraps |
|-----------|-------|
| `{ watched: true }` | `markWatched(config, sourceId, userCred)` |
| `{ inHistory: false }` | `removeFromHistory(config, sourceId, userCred)` |

**`getTrending`** — expand existing implementation to accept category in opts:
- Currently: returns all trending
- After: accepts `config.metadata?.category` or similar to call `getTrendingByCategory`

**Note:** `normalizeVideo` stays as a direct export — it's a data transformation helper, not an interface method. Routes that use it will import it directly (acceptable for normalization utilities).

### RomM (16 route imports → 7 interface methods)

**`getCategories(config, userCred)`** wrapping:
- Returns platforms via `getPlatforms(config, userCred)` mapped to `{ id, name, count, image }`

**`getSubItems(config, parentId, type, opts, userCred)`** wrapping:

| `type` | Wraps |
|--------|-------|
| `'collection'` | `getCollections(config, userCred)` (when parentId is null/empty) |
| `'collection'` | `getCollection(config, parentId, userCred)` (when parentId provided) |

**`manageCollection(config, action, data, userCred)`** wrapping:

| Action | Wraps |
|--------|-------|
| `'create'` | `createCollection(config, data, userCred)` |
| `'update'` | `updateCollection(config, data.id, data, userCred)` |
| `'delete'` | `deleteCollection(config, data.id, userCred)` |
| `'addItems'` / `'removeItems'` | `updateCollectionRoms(config, data.id, data.itemIds, userCred)` |

**`setItemStatus(config, sourceId, status, userCred)`** wrapping:

| Status key | Wraps |
|-----------|-------|
| `{ playStatus: string }` | `updateUserRomStatus(config, sourceId, status.playStatus, userCred)` |
| `{ favorite: boolean }` | `toggleRomFavorite(config, sourceId, status.favorite, userCred)` |

**`uploadContent(config, parentId, type, blob, fileName, userCred)`** wrapping:

| `type` | Wraps |
|--------|-------|
| `'state'` | `uploadRomState(config, parentId, blob, fileName, userCred)` |
| `'save'` | `uploadRomSave(config, parentId, blob, fileName, userCred)` |

**`downloadContent(config, sourceId, format, userCred)`** wrapping:

| `format` | Wraps |
|----------|-------|
| `undefined` | `downloadRomContent(config, sourceId, userCred)` |
| `'state:{stateId}'` | `downloadRomState(config, sourceId, stateId, userCred)` |
| `'save:{saveId}'` | `downloadRomSave(config, sourceId, saveId, userCred)` |

**`enrichItem(config, item, enrichmentType, userCred)`** wrapping:

| `enrichmentType` | Wraps |
|-----------------|-------|
| `'saves'` | `getRomSaves(config, item.sourceId, userCred)` → adds to `item.metadata.saves` |
| `'states'` | `getRomStates(config, item.sourceId, userCred)` → adds to `item.metadata.states` |
| `'screenshots'` | `getRomScreenshots(config, item.sourceId, userCred)` → adds to `item.metadata.screenshots` |

### Calibre (9 route imports → 5 interface methods)

**`getCategories(config, userCred)`** wrapping:
- Returns authors via `getCalibreAuthors(config, userCred)` mapped to `{ id, name, count }`
- Or categories via `getCalibreCategories(config, userCred)`
- Discriminated by a `type` parameter if needed, or combine both

**`getServiceData(config, dataType, params, userCred)`** wrapping:

| `dataType` | Wraps |
|-----------|-------|
| `'series'` | `getCalibreSeries(config, userCred)` |
| `'all'` | `getAllBooks(config, userCred)` |
| `'categories'` | `getCalibreCategories(config, userCred)` |
| `'authors'` | `getCalibreAuthors(config, userCred)` |

**`enrichItem(config, item, enrichmentType, userCred)`** wrapping:

| `enrichmentType` | Wraps |
|-----------------|-------|
| `'formats'` | `getCalibreBookFormats(config, item.sourceId, userCred)` |
| `'related'` | `getRelatedBooks(config, item.sourceId, userCred)` |

**`setItemStatus(config, sourceId, status, userCred)`** wrapping:

| Status key | Wraps |
|-----------|-------|
| `{ read: boolean }` | `toggleReadStatus(config, sourceId, userCred)` |

**`downloadContent(config, sourceId, format, userCred)`** wrapping:
- `downloadBook(config, sourceId, format, userCred)` — format is 'epub', 'pdf', etc.

### Jellyfin (2 route imports → 2 interface methods)

**`getSubItems(config, parentId, type, opts, userCred)`** wrapping:

| `type` | Wraps |
|--------|-------|
| `'season'` | `getSeasons(config, parentId, userCred)` |

**`getServiceData(config, dataType, params, userCred)`** wrapping:

| `dataType` | Wraps |
|-----------|-------|
| `'programs'` | `getChannelPrograms(config, params.channelId, userCred)` |
| `'tv-guide'` | `getLiveTvGuide(config, userCred)` |

### Excluded from Migration (stay as direct imports)

- **Bazarr admin** (`getProviderStatus`, `getLanguageProfiles`, `getSystemHistory`) — admin-only
- **Prowlarr admin** (`getProwlarrIndexers`, `getProwlarrStats`) — admin-only
- **Overseerr** (`importJellyfinUser`) — admin provisioning
- **StreamyStats** (`getStreamyStatsRecommendations`) — used by recommendation provider, not routes
- **Invidious** (`normalizeVideo`) — data transformation utility
- **Calibre** (`getSession`) — internal auth helper
- **Jellyfin** (`JellyfinSeason` type) — type import only

## Route Migration Pattern

Before:
```typescript
import { getPlatforms } from '$lib/adapters/romm';
const config = getConfigsForMediaType('game')[0];
const platforms = await getPlatforms(config, userCred);
```

After:
```typescript
import { registry } from '$lib/adapters/registry';
const config = getConfigsForMediaType('game')[0];
const adapter = registry.get(config.type);
const platforms = await adapter?.getCategories?.(config, userCred) ?? [];
```

## Success Criteria

- Zero direct adapter imports in route files (except excluded list above)
- All existing functionality works identically
- Routes use only registry + interface methods
- Existing adapter exports remain as internal helpers (no API break for external consumers)
