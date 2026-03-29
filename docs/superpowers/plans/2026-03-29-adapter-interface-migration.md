# Adapter Interface Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ~57 direct adapter imports in route files with standardized interface method calls through the registry.

**Architecture:** For each adapter (Invidious, RomM, Calibre, Jellyfin), implement the new interface methods as thin wrappers around existing exported functions, then migrate all route files to use `registry.get(type)?.method()` instead of direct imports.

**Tech Stack:** SvelteKit, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-29-adapter-interface-migration-design.md`

---

## Task 1: Invidious — Implement Interface Methods

**Files:**
- Modify: `src/lib/adapters/invidious.ts`

- [ ] **Step 1: Add interface method implementations to the adapter object**

Read `src/lib/adapters/invidious.ts` fully. The adapter already exports standalone functions. Add these methods to the `invidiousAdapter` object, each calling the existing exports:

**`getServiceData`** — dispatch by `dataType`:
```typescript
async getServiceData(config, dataType, params, userCred) {
  switch (dataType) {
    case 'subscriptions': return getSubscriptions(config, userCred);
    case 'subscription-feed': return getSubscriptionFeed(config, params?.page as number, userCred);
    case 'playlists': return getUserPlaylists(config, userCred);
    case 'watch-history': return getWatchHistory(config, params?.page as number, userCred);
    case 'channel': return getChannel(config, params?.channelId as string);
    case 'channel-videos': return getChannelVideos(config, params?.channelId as string, params?.sort as string);
    case 'comments': return getComments(config, params?.videoId as string, params?.sort as string);
    case 'search-suggestions': return getSearchSuggestions(config, params?.query as string);
    default: return null;
  }
},
```

**`manageCollection`** — playlist CRUD:
```typescript
async manageCollection(config, action, data, userCred) {
  switch (action) {
    case 'create': return createPlaylist(config, data.name!, data.privacy as string ?? 'private', userCred);
    case 'delete': await deletePlaylist(config, data.id!, userCred); return;
    case 'addItems': await addToPlaylist(config, data.id!, data.itemIds![0], userCred); return;
    case 'removeItems': await removeFromPlaylist(config, data.id!, data.itemIds![0], userCred); return;
    default: return;
  }
},
```

**`manageSubscription`**:
```typescript
async manageSubscription(config, action, channelId, userCred) {
  if (action === 'subscribe') await subscribe(config, channelId, userCred);
  else await unsubscribe(config, channelId, userCred);
},
```

**`setItemStatus`**:
```typescript
async setItemStatus(config, sourceId, status, userCred) {
  if (status.watched) await markWatched(config, sourceId, userCred);
  if (status.inHistory === false) await removeFromHistory(config, sourceId, userCred);
},
```

- [ ] **Step 2: Verify type check**

Run: `pnpm check 2>&1 | grep 'invidious' | grep ERROR` — should be 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/adapters/invidious.ts
git commit -m "feat: implement interface methods on Invidious adapter"
```

---

## Task 2: Invidious — Migrate Route Files

**Files:** ~21 route files that import from `$lib/adapters/invidious`

- [ ] **Step 1: Migrate all Invidious route imports**

For each file, replace direct imports with registry calls. The pattern:

**Before:**
```typescript
import { getWatchHistory } from '$lib/adapters/invidious';
const configs = getConfigsForMediaType('video');
const config = configs[0];
const history = await getWatchHistory(config, page, userCred);
```

**After:**
```typescript
import { registry } from '$lib/adapters/registry';
const configs = getConfigsForMediaType('video');
const config = configs[0];
const adapter = registry.get(config.type);
const history = await adapter?.getServiceData?.(config, 'watch-history', { page }, userCred);
```

Files to migrate (find with `grep -rn "from '\\$lib/adapters/invidious'" src/routes/`):

**getServiceData migrations:**
- `src/routes/videos/+page.server.ts` — `getTrendingByCategory` → `getServiceData('trending-by-category', { category })`; `getSubscriptionFeed` → `getServiceData('subscription-feed', { page })`
- `src/routes/videos/history/+page.server.ts` — `getWatchHistory` → `getServiceData('watch-history', { page })`; `invidiousAdapter` → `registry.get(config.type)`
- `src/routes/videos/channel/[id]/+page.server.ts` — `getChannel` → `getServiceData('channel', { channelId })`; `getChannelVideos` → `getServiceData('channel-videos', { channelId, sort })`; `getSubscriptions` → `getServiceData('subscriptions')`
- `src/routes/videos/subscriptions/+page.server.ts` — `getSubscriptionFeed` → `getServiceData('subscription-feed', { page })`
- `src/routes/videos/playlists/+page.server.ts` — `getUserPlaylists` → `getServiceData('playlists')`
- `src/routes/api/video/trending/+server.ts` — `getTrendingByCategory` → `getServiceData('trending-by-category', { category })`
- `src/routes/api/video/suggestions/+server.ts` — `getSearchSuggestions` → `getServiceData('search-suggestions', { query })`
- `src/routes/api/video/history/+server.ts` — `getWatchHistory` → `getServiceData('watch-history', { page })`
- `src/routes/api/video/history/resolved/+server.ts` — `getWatchHistory` + `invidiousAdapter` → registry calls
- `src/routes/api/video/channels/[id]/+server.ts` — `getChannel`, `getChannelVideos` → getServiceData
- `src/routes/api/video/comments/[id]/+server.ts` — `getComments` → `getServiceData('comments', { videoId })`
- `src/routes/api/video/popular/+server.ts` — `invidiousAdapter` → `registry.get(config.type)`
- `src/routes/api/video/subscriptions/+server.ts` — `getSubscriptions`, `getSubscriptionFeed` → getServiceData
- `src/routes/api/video/subscriptions/feed/+server.ts` — `getSubscriptionFeed` → getServiceData
- `src/routes/api/search/suggestions/+server.ts` — `getSearchSuggestions` → getServiceData

**manageCollection migrations:**
- `src/routes/api/video/playlists/+server.ts` — `getUserPlaylists`, `createPlaylist` → getServiceData + manageCollection
- `src/routes/api/video/playlists/[id]/+server.ts` — `deletePlaylist` → manageCollection('delete')
- `src/routes/api/video/playlists/[id]/videos/+server.ts` — `addToPlaylist` → manageCollection('addItems')
- `src/routes/api/video/playlists/[id]/videos/[index]/+server.ts` — `removeFromPlaylist` → manageCollection('removeItems')

**manageSubscription migrations:**
- `src/routes/api/video/subscriptions/[ucid]/+server.ts` — `subscribe`, `unsubscribe` → manageSubscription

**setItemStatus migrations:**
- `src/routes/api/video/history/[id]/+server.ts` — `markWatched`, `removeFromHistory` → setItemStatus
- `src/routes/api/video/progress/+server.ts` — `markWatched` → setItemStatus

**Keep as direct import:**
- `normalizeVideo` — data transformation utility, acceptable as direct import
- `src/routes/videos/playlists/[id]/+page.server.ts` — uses `normalizeVideo`
- `src/routes/api/video/search/+server.ts` — uses `normalizeVideo`

- [ ] **Step 2: Verify type check + grep for remaining imports**

Run: `pnpm check 2>&1 | grep -c ERROR` — same count
Run: `grep -rn "from '\\$lib/adapters/invidious'" src/routes/ | grep -v normalizeVideo` — should be empty

- [ ] **Step 3: Commit**

```bash
git add src/routes/
git commit -m "refactor: migrate Invidious route imports to registry interface methods"
```

---

## Task 3: RomM — Implement Interface Methods + Migrate Routes

**Files:**
- Modify: `src/lib/adapters/romm.ts`
- Modify: ~9 route files

- [ ] **Step 1: Add interface methods to RomM adapter**

Read `src/lib/adapters/romm.ts` fully. Add these methods to the adapter object:

**`getCategories`** — wraps getPlatforms:
```typescript
async getCategories(config, userCred) {
  const platforms = await getPlatforms(config, userCred);
  return platforms.map((p: any) => ({
    id: String(p.id),
    name: p.display_name ?? p.name,
    count: p.rom_count,
    image: p.url_logo
  }));
},
```

**`getSubItems`** — wraps collections:
```typescript
async getSubItems(config, parentId, type, opts, userCred) {
  if (type === 'collection' && !parentId) {
    const collections = await getCollections(config, userCred);
    return { items: collections as any, total: collections.length };
  }
  if (type === 'collection' && parentId) {
    const collection = await getCollection(config, parentId, userCred);
    return { items: collection?.roms ?? [], total: collection?.roms?.length ?? 0 };
  }
  return { items: [], total: 0 };
},
```

**`manageCollection`**:
```typescript
async manageCollection(config, action, data, userCred) {
  switch (action) {
    case 'create': return createCollection(config, data, userCred);
    case 'update': await updateCollection(config, data.id!, data, userCred); return;
    case 'delete': await deleteCollection(config, data.id!, userCred); return;
    case 'addItems':
    case 'removeItems':
      await updateCollectionRoms(config, data.id!, data.itemIds!, userCred); return;
    default: return;
  }
},
```

**`setItemStatus`**:
```typescript
async setItemStatus(config, sourceId, status, userCred) {
  if (status.playStatus != null) await updateUserRomStatus(config, sourceId, status.playStatus as string, userCred);
  if (status.favorite != null) await toggleRomFavorite(config, sourceId, status.favorite as boolean, userCred);
},
```

**`uploadContent`**:
```typescript
async uploadContent(config, parentId, type, blob, fileName, userCred) {
  if (type === 'state') await uploadRomState(config, parentId, blob, fileName, userCred);
  else if (type === 'save') await uploadRomSave(config, parentId, blob, fileName, userCred);
},
```

**`downloadContent`**:
```typescript
async downloadContent(config, sourceId, format, userCred) {
  if (format?.startsWith('state:')) return downloadRomState(config, sourceId, format.split(':')[1], userCred);
  if (format?.startsWith('save:')) return downloadRomSave(config, sourceId, format.split(':')[1], userCred);
  return downloadRomContent(config, sourceId, userCred);
},
```

**`enrichItem`**:
```typescript
async enrichItem(config, item, enrichmentType, userCred) {
  const id = item.sourceId;
  if (enrichmentType === 'saves') return { ...item, metadata: { ...item.metadata, saves: await getRomSaves(config, id, userCred) } };
  if (enrichmentType === 'states') return { ...item, metadata: { ...item.metadata, states: await getRomStates(config, id, userCred) } };
  if (enrichmentType === 'screenshots') return { ...item, metadata: { ...item.metadata, screenshots: await getRomScreenshots(config, id, userCred) } };
  return item;
},
```

- [ ] **Step 2: Migrate route files**

Replace direct RomM imports with registry calls in:
- `src/routes/games/+page.server.ts` — `getPlatforms`, `getCollections` → getCategories, getSubItems
- `src/routes/games/stats/+page.server.ts` — `getPlatforms` → getCategories
- `src/routes/games/platform/[slug]/+page.server.ts` — `getPlatforms` → getCategories
- `src/routes/play/[id]/+page.server.ts` — `getRomSaves`, `getRomStates` → enrichItem
- `src/routes/api/games/platforms/+server.ts` — `getPlatforms` → getCategories
- `src/routes/api/games/collections/+server.ts` — `getCollections`, `createCollection` → getSubItems, manageCollection
- `src/routes/api/games/collections/[id]/+server.ts` — `updateCollection`, `deleteCollection`, `getCollection`, `updateCollectionRoms` → manageCollection, getSubItems
- `src/routes/api/games/[id]/states/+server.ts` — `getRomStates`, `uploadRomState` → enrichItem, uploadContent
- `src/routes/api/games/[id]/states/[stateId]/+server.ts` — `downloadRomState`, `deleteRomState` → downloadContent, setItemStatus/direct
- `src/routes/api/games/[id]/saves/+server.ts` — `getRomSaves`, `uploadRomSave` → enrichItem, uploadContent
- `src/routes/api/games/[id]/saves/[saveId]/+server.ts` — `downloadRomSave`, `deleteRomSave` → downloadContent
- `src/routes/api/games/[id]/rom/+server.ts` — `downloadRomContent` → downloadContent
- `src/routes/api/games/[id]/status/+server.ts` — `updateUserRomStatus` → setItemStatus
- `src/routes/api/games/[id]/favorite/+server.ts` — `toggleRomFavorite` → setItemStatus
- `src/routes/api/games/[id]/screenshots/+server.ts` — `getRomScreenshots` → enrichItem
- `src/routes/media/[type]/[id]/+page.server.ts` — `getRomSaves`, `getRomStates`, `getRomScreenshots` → enrichItem

- [ ] **Step 3: Verify + commit**

Run: `grep -rn "from '\\$lib/adapters/romm'" src/routes/` — should be empty
Run: `pnpm check 2>&1 | grep -c ERROR` — same count

```bash
git add src/lib/adapters/romm.ts src/routes/
git commit -m "refactor: migrate RomM route imports to registry interface methods"
```

---

## Task 4: Calibre — Implement Interface Methods + Migrate Routes

**Files:**
- Modify: `src/lib/adapters/calibre.ts`
- Modify: ~6 route files

- [ ] **Step 1: Add interface methods to Calibre adapter**

Read `src/lib/adapters/calibre.ts` fully. Add:

**`getServiceData`**:
```typescript
async getServiceData(config, dataType, params, userCred) {
  switch (dataType) {
    case 'series': return getCalibreSeries(config, userCred);
    case 'all': return getAllBooks(config, userCred);
    case 'categories': return getCalibreCategories(config, userCred);
    case 'authors': return getCalibreAuthors(config, userCred);
    default: return null;
  }
},
```

**`enrichItem`**:
```typescript
async enrichItem(config, item, enrichmentType, userCred) {
  if (enrichmentType === 'formats') return { ...item, metadata: { ...item.metadata, formats: await getCalibreBookFormats(config, item.sourceId, userCred) } };
  if (enrichmentType === 'related') return { ...item, metadata: { ...item.metadata, related: await getRelatedBooks(config, item.sourceId, userCred) } };
  return item;
},
```

**`setItemStatus`**:
```typescript
async setItemStatus(config, sourceId, status, userCred) {
  if (status.read != null) await toggleReadStatus(config, sourceId, userCred);
},
```

**`downloadContent`**:
```typescript
async downloadContent(config, sourceId, format, userCred) {
  return downloadBook(config, sourceId, format!, userCred);
},
```

- [ ] **Step 2: Migrate route files**

- `src/routes/books/+page.server.ts` — `getAllBooks`, `getCalibreSeries`, `getCalibreCategories`, `getCalibreAuthors` → getServiceData
- `src/routes/api/books/categories/+server.ts` — `getCalibreCategories` → getServiceData('categories')
- `src/routes/api/books/series/+server.ts` — `getCalibreSeries` → getServiceData('series')
- `src/routes/api/books/authors/+server.ts` — `getCalibreAuthors` → getServiceData('authors')
- `src/routes/api/books/[id]/download/[format]/+server.ts` — `downloadBook` → downloadContent
- `src/routes/api/books/[id]/read/+server.ts` — `downloadBook` → downloadContent
- `src/routes/api/books/[id]/toggle-read/+server.ts` — `toggleReadStatus` → setItemStatus
- `src/routes/media/[type]/[id]/+page.server.ts` — `getRelatedBooks`, `getCalibreBookFormats` → enrichItem

- [ ] **Step 3: Verify + commit**

Run: `grep -rn "from '\\$lib/adapters/calibre'" src/routes/` — should be empty
Run: `pnpm check 2>&1 | grep -c ERROR` — same count

```bash
git add src/lib/adapters/calibre.ts src/routes/
git commit -m "refactor: migrate Calibre route imports to registry interface methods"
```

---

## Task 5: Jellyfin — Implement Interface Methods + Migrate Routes

**Files:**
- Modify: `src/lib/adapters/jellyfin.ts`
- Modify: 2 route files

- [ ] **Step 1: Add interface methods to Jellyfin adapter**

The Jellyfin adapter may already have `getSubItems` from earlier work. Add or expand:

**`getSubItems`** — expand for seasons:
```typescript
async getSubItems(config, parentId, type, opts, userCred) {
  if (type === 'season') {
    const seasons = await getSeasons(config, parentId, userCred);
    return { items: seasons.map((s: any) => ({ ...s, type: 'show' })), total: seasons.length };
  }
  return { items: [], total: 0 };
},
```

**`getServiceData`** — for live TV:
```typescript
async getServiceData(config, dataType, params, userCred) {
  switch (dataType) {
    case 'programs': return getChannelPrograms(config, params?.channelId as string, userCred);
    case 'tv-guide': return getLiveTvGuide(config, userCred);
    default: return null;
  }
},
```

- [ ] **Step 2: Migrate route files**

- `src/routes/media/[type]/[id]/+page.server.ts` — `getSeasons as getJellyfinSeasons` → adapter.getSubItems(config, id, 'season')
- `src/routes/api/live/guide/+server.ts` — `getChannelPrograms`, `getLiveTvGuide` → adapter.getServiceData

Also remove `JellyfinSeason` type import if no longer needed.

- [ ] **Step 3: Verify + commit**

Run: `grep -rn "from '\\$lib/adapters/jellyfin'" src/routes/ | grep -v types` — should be empty
Run: `pnpm check 2>&1 | grep -c ERROR` — same count

```bash
git add src/lib/adapters/jellyfin.ts src/routes/
git commit -m "refactor: migrate Jellyfin route imports to registry interface methods"
```

---

## Task 6: Final Audit + Media Detail Page Cleanup

**Files:**
- Modify: `src/routes/media/[type]/[id]/+page.server.ts`

The media detail page imports from multiple adapters (Jellyfin, Bazarr, RomM, Calibre). After Tasks 2-5, most should be migrated. This task handles any remaining direct imports and verifies the full migration.

- [ ] **Step 1: Check remaining direct imports**

Run: `grep -rn "from '\\$lib/adapters/" src/routes/ | grep -v registry | grep -v types | grep -v base | grep -v normalizeVideo`

Any remaining imports (except excluded: Bazarr admin, Prowlarr admin, Overseerr admin, normalizeVideo) need migration.

- [ ] **Step 2: Fix any remaining imports**

Apply the same pattern as previous tasks.

- [ ] **Step 3: Final verification**

Run: `pnpm check 2>&1 | grep -c ERROR` — same count
Run: `pnpm vitest run` — all tests pass
Run full grep to confirm only allowed direct imports remain.

- [ ] **Step 4: Commit**

```bash
git add src/routes/
git commit -m "refactor: complete adapter interface migration — zero unauthorized direct imports"
```

---

## Task Summary

| Task | Adapter | Route files | Interface methods |
|------|---------|-------------|-------------------|
| 1 | Invidious adapter | 0 | 4 methods |
| 2 | Invidious routes | ~21 | — |
| 3 | RomM adapter + routes | ~16 | 7 methods |
| 4 | Calibre adapter + routes | ~8 | 4 methods |
| 5 | Jellyfin adapter + routes | ~2 | 2 methods |
| 6 | Final audit | varies | — |
