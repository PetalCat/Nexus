# Adapter Layer Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nexus fully adapter-agnostic so a new service adapter requires only one file + one registry line — no server code changes.

**Architecture:** Add capability metadata and standardized methods to `ServiceAdapter`, then incrementally migrate consumers (services.ts, session-poller.ts, media-sync.ts, domain routes) to use registry queries instead of hardcoded service type checks and direct adapter imports.

**Tech Stack:** SvelteKit, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-28-adapter-consolidation-design.md`

---

## Task 1: Add Capability Metadata & New Types to ServiceAdapter Interface

**Files:**
- Modify: `src/lib/adapters/base.ts`
- Modify: `src/lib/adapters/types.ts`
- Test: `src/lib/adapters/__tests__/registry.test.ts`

- [ ] **Step 1: Write test for capability metadata lookup**

Create `src/lib/adapters/__tests__/registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { registry } from '../registry';

describe('AdapterRegistry', () => {
  it('returns all registered adapters', () => {
    const all = registry.all();
    expect(all.length).toBeGreaterThan(0);
  });

  it('every adapter has required fields', () => {
    for (const adapter of registry.all()) {
      expect(adapter.id).toBeTruthy();
      expect(adapter.displayName).toBeTruthy();
      expect(typeof adapter.defaultPort).toBe('number');
      expect(typeof adapter.ping).toBe('function');
    }
  });

  it('library adapters have isLibrary set', () => {
    const libraries = registry.all().filter((a) => a.isLibrary);
    const libraryIds = libraries.map((a) => a.id).sort();
    expect(libraryIds).toEqual(['calibre', 'invidious', 'jellyfin', 'romm']);
  });

  it('searchable adapters have isSearchable set', () => {
    const searchable = registry.all().filter((a) => a.isSearchable);
    expect(searchable.length).toBeGreaterThanOrEqual(7);
    // Enrichment-only services should NOT be searchable
    expect(searchable.find((a) => a.id === 'bazarr')).toBeUndefined();
    expect(searchable.find((a) => a.id === 'prowlarr')).toBeUndefined();
  });

  it('enrichment-only adapters are flagged', () => {
    const enrichmentOnly = registry.all().filter((a) => a.isEnrichmentOnly);
    const ids = enrichmentOnly.map((a) => a.id).sort();
    expect(ids).toEqual(['bazarr', 'prowlarr']);
  });

  it('authVia resolves to a valid adapter', () => {
    const withAuthVia = registry.all().filter((a) => a.authVia);
    for (const adapter of withAuthVia) {
      expect(registry.get(adapter.authVia!)).toBeDefined();
    }
  });

  it('searchPriority defaults to Infinity when not set', () => {
    for (const adapter of registry.all()) {
      const priority = adapter.searchPriority ?? Infinity;
      expect(typeof priority).toBe('number');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/adapters/__tests__/registry.test.ts`
Expected: FAIL — `isLibrary`, `isSearchable`, `isEnrichmentOnly`, `authVia`, `searchPriority` don't exist yet.

- [ ] **Step 3: Add new types to `types.ts`**

Add to the end of `src/lib/adapters/types.ts`:

```typescript
/** Active playback/activity session reported by an adapter */
export interface NexusSession {
  sessionId: string;
  userId?: string;
  username?: string;
  mediaId: string;
  mediaTitle: string;
  mediaType: MediaType;
  state: 'playing' | 'paused' | 'stopped';
  progress: number;
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

/** Item returned by syncLibraryItems for recommendation engine ingestion */
export interface SyncItem {
  sourceId: string;
  title: string;
  sortTitle?: string;
  mediaType: MediaType;
  year?: number;
  genres?: string[];
  poster?: string;
  backdrop?: string;
  duration?: number;
  rating?: number;
  tmdbId?: string;
  imdbId?: string;
}

/** Upcoming media release from calendar endpoints */
export interface CalendarItem {
  id: string;
  sourceId: string;
  serviceId: string;
  title: string;
  mediaType: MediaType;
  releaseDate: string;
  poster?: string;
  overview?: string;
  status?: 'upcoming' | 'released' | 'downloading';
}
```

- [ ] **Step 4: Add capability fields and new methods to `ServiceAdapter` in `base.ts`**

Add these fields after the `userLinkable` field (line 42) in `src/lib/adapters/base.ts`:

```typescript
  // ---- Capability metadata ----

  /** Whether this adapter provides a browsable media library */
  readonly isLibrary?: boolean;

  /** Whether this adapter should appear in unified search */
  readonly isSearchable?: boolean;

  /** Search result priority (0 = highest). Defaults to Infinity. */
  readonly searchPriority?: number;

  /** Delegates user auth to another adapter type (e.g. 'jellyfin') */
  readonly authVia?: string;

  /** No user-facing content — background enrichment only (e.g. Bazarr, Prowlarr) */
  readonly isEnrichmentOnly?: boolean;

  /** Poll interval in ms for pollSessions. Defaults to 10000 (10s). */
  readonly pollIntervalMs?: number;
```

Also add the import for new types at the top of `base.ts`:

```typescript
import type { ServiceConfig, ServiceHealth, NexusRequest, UnifiedMedia, UnifiedSearchResult, UserCredential, ExternalUser, NexusSession, SyncItem } from './types';
```

Add these new methods before the closing `}` of the interface:

```typescript
  // ---- Extended methods (adapter consolidation) ----

  /** Poll active playback/activity sessions */
  pollSessions?(config: ServiceConfig, userCred?: UserCredential): Promise<NexusSession[]>;

  /** Sync all library items for recommendation engine */
  syncLibraryItems?(config: ServiceConfig, userCred?: UserCredential): Promise<SyncItem[]>;

  /** Auth headers needed to proxy images from this service */
  getImageHeaders?(config: ServiceConfig, userCred?: UserCredential): Promise<Record<string, string>>;

  /** Sub-items: seasons, albums, tracks, platforms, collections */
  getSubItems?(config: ServiceConfig, parentId: string, type: string,
    opts?: { limit?: number; offset?: number; sort?: string },
    userCred?: UserCredential): Promise<{ items: UnifiedMedia[]; total: number }>;

  /** Detail for child items: album tracks, season episodes */
  getSubItemDetail?(config: ServiceConfig, parentId: string, childId: string,
    userCred?: UserCredential): Promise<UnifiedMedia[]>;

  /** Related items: same-author books, instant mix, similar games */
  getRelated?(config: ServiceConfig, sourceId: string,
    userCred?: UserCredential): Promise<UnifiedMedia[]>;

  /** Browsing categories: genres, tags, platforms, authors */
  getCategories?(config: ServiceConfig,
    userCred?: UserCredential): Promise<Array<{ id: string; name: string; count?: number; image?: string }>>;

  /** Set item status: read/unread, favorite, watched */
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

  /** Download binary content (books, ROMs, save states) */
  downloadContent?(config: ServiceConfig, sourceId: string,
    format?: string, userCred?: UserCredential): Promise<Response>;

  /** Enrich an existing item with additional metadata */
  enrichItem?(config: ServiceConfig, item: UnifiedMedia,
    enrichmentType?: string, userCred?: UserCredential): Promise<UnifiedMedia>;

  /** Fetch service-specific data that doesn't map to UnifiedMedia */
  getServiceData?(config: ServiceConfig, dataType: string,
    params?: Record<string, unknown>,
    userCred?: UserCredential): Promise<unknown>;
```

- [ ] **Step 5: Run test to verify it still fails (missing adapter values)**

Run: `pnpm vitest run src/lib/adapters/__tests__/registry.test.ts`
Expected: FAIL — adapters don't have `isLibrary` etc. yet.

- [ ] **Step 6: Commit interface changes**

```bash
git add src/lib/adapters/base.ts src/lib/adapters/types.ts src/lib/adapters/__tests__/registry.test.ts
git commit -m "feat: add capability metadata and extended methods to ServiceAdapter interface"
```

---

## Task 2: Add Capability Metadata to All Existing Adapters

**Files:**
- Modify: `src/lib/adapters/jellyfin.ts`
- Modify: `src/lib/adapters/calibre.ts`
- Modify: `src/lib/adapters/romm.ts`
- Modify: `src/lib/adapters/invidious.ts`
- Modify: `src/lib/adapters/overseerr.ts`
- Modify: `src/lib/adapters/radarr.ts`
- Modify: `src/lib/adapters/sonarr.ts`
- Modify: `src/lib/adapters/lidarr.ts`
- Modify: `src/lib/adapters/prowlarr.ts`
- Modify: `src/lib/adapters/bazarr.ts`
- Modify: `src/lib/adapters/streamystats.ts`
- Test: `src/lib/adapters/__tests__/registry.test.ts`

- [ ] **Step 1: Add capability fields to each adapter**

For each adapter file, add the new fields after the existing `abbreviation` field. Here are the exact values:

**jellyfin.ts:**
```typescript
  isLibrary: true,
  isSearchable: true,
  searchPriority: 0,
```

**calibre.ts:**
```typescript
  isLibrary: true,
  isSearchable: true,
  searchPriority: 0,
```

**romm.ts:**
```typescript
  isLibrary: true,
  isSearchable: true,
  searchPriority: 0,
```

**invidious.ts:**
```typescript
  isLibrary: true,
  isSearchable: true,
  searchPriority: 0,
```

**overseerr.ts:**
```typescript
  isSearchable: true,
  searchPriority: 1,
  authVia: 'jellyfin',
```

**radarr.ts:**
```typescript
  isSearchable: true,
  searchPriority: 3,
```

**sonarr.ts:**
```typescript
  isSearchable: true,
  searchPriority: 3,
```

**lidarr.ts:**
```typescript
  isSearchable: true,
  searchPriority: 2,
```

**prowlarr.ts:**
```typescript
  isEnrichmentOnly: true,
```

**bazarr.ts:**
```typescript
  isEnrichmentOnly: true,
```

**streamystats.ts:**
```typescript
  authVia: 'jellyfin',
```

- [ ] **Step 2: Run registry tests**

Run: `pnpm vitest run src/lib/adapters/__tests__/registry.test.ts`
Expected: PASS — all capability metadata tests pass.

- [ ] **Step 3: Run full type check**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same error count as before (only vendor file errors).

- [ ] **Step 4: Commit**

```bash
git add src/lib/adapters/*.ts
git commit -m "feat: add capability metadata to all existing adapters"
```

---

## Task 3: Migrate `services.ts` to Use Capability Metadata

**Files:**
- Modify: `src/lib/server/services.ts`
- Modify: `src/lib/adapters/registry.ts`
- Test: `src/lib/adapters/__tests__/registry.test.ts`

- [ ] **Step 1: Add helper methods to `AdapterRegistry`**

In `src/lib/adapters/registry.ts`, add these methods to the `AdapterRegistry` class:

```typescript
  /** All adapters that provide browsable media libraries */
  libraries(): ServiceAdapter[] {
    return this.all().filter((a) => a.isLibrary);
  }

  /** All adapters that should appear in unified search, sorted by priority */
  searchable(): ServiceAdapter[] {
    return this.all()
      .filter((a) => a.isSearchable)
      .sort((a, b) => (a.searchPriority ?? Infinity) - (b.searchPriority ?? Infinity));
  }

  /** All adapters matching a given media type */
  byMediaType(mediaType: string): ServiceAdapter[] {
    return this.all().filter((a) => a.mediaTypes?.includes(mediaType as any));
  }

  /** Resolve the adapter that provides auth for this adapter (follows authVia chain) */
  resolveAuthAdapter(adapter: ServiceAdapter): ServiceAdapter | undefined {
    if (!adapter.authVia) return undefined;
    return this.get(adapter.authVia);
  }
```

- [ ] **Step 2: Add test for new registry helpers**

Add to `src/lib/adapters/__tests__/registry.test.ts`:

```typescript
  it('libraries() returns only isLibrary adapters', () => {
    const libs = registry.libraries();
    expect(libs.every((a) => a.isLibrary)).toBe(true);
    expect(libs.length).toBe(4);
  });

  it('searchable() returns sorted by priority', () => {
    const searchable = registry.searchable();
    const priorities = searchable.map((a) => a.searchPriority ?? Infinity);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]);
    }
  });

  it('byMediaType filters correctly', () => {
    const movieAdapters = registry.byMediaType('movie');
    expect(movieAdapters.every((a) => a.mediaTypes?.includes('movie'))).toBe(true);
  });

  it('resolveAuthAdapter follows authVia', () => {
    const ss = registry.get('streamystats')!;
    const authAdapter = registry.resolveAuthAdapter(ss);
    expect(authAdapter?.id).toBe('jellyfin');
  });
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/lib/adapters/__tests__/registry.test.ts`
Expected: PASS

- [ ] **Step 4: Replace hardcoded sets in `services.ts`**

In `src/lib/server/services.ts`, make these changes:

Add import at top:
```typescript
import { registry } from '$lib/adapters/registry';
```

Replace `LIBRARY_TYPES` set (around line 203):
```typescript
// OLD:
const LIBRARY_TYPES = new Set(['jellyfin', 'calibre', 'romm', 'invidious']);

// NEW:
const LIBRARY_TYPES = new Set(registry.libraries().map((a) => a.id));
```

Replace `resolveUserCred` special cases (around line 188):
```typescript
// OLD:
if (config.type === 'streamystats') {
  const jfConfig = getEnabledConfigs().find((c) => c.type === 'jellyfin');
  ...
}

// NEW:
const adapter = registry.get(config.type);
if (adapter?.authVia) {
  const authConfig = getEnabledConfigs().find((c) => c.type === adapter.authVia);
  ...
}
```

Replace search exclusion/priority sets in `unifiedSearch` (around line 545):
```typescript
// OLD:
const excludeFromSearch = new Set(['invidious', 'prowlarr', 'streamystats', 'bazarr']);
const libraryTypes = new Set(['jellyfin', 'calibre', 'romm']);
const priority: Record<string, number> = { jellyfin: 0, calibre: 0, romm: 0, overseerr: 1, lidarr: 2, radarr: 3, sonarr: 3 };

// NEW:
const searchableIds = new Set(registry.searchable().map((a) => a.id));
const searchPriority = Object.fromEntries(
  registry.searchable().map((a) => [a.id, a.searchPriority ?? Infinity])
);
```

Update filter logic to use `searchableIds` and `searchPriority` instead of the old sets.

- [ ] **Step 5: Verify type check passes**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same error count as before.

- [ ] **Step 6: Commit**

```bash
git add src/lib/adapters/registry.ts src/lib/server/services.ts src/lib/adapters/__tests__/registry.test.ts
git commit -m "refactor: replace hardcoded service type sets with adapter capability metadata"
```

---

## Task 4: Migrate Session Polling to Adapter Methods

**Files:**
- Modify: `src/lib/adapters/jellyfin.ts`
- Modify: `src/lib/adapters/romm.ts`
- Modify: `src/lib/server/session-poller.ts`

- [ ] **Step 1: Implement `pollSessions` on Jellyfin adapter**

Move the `JfSession` interface, `JF_TYPE_MAP`, `extractMetadata()`, and `pollJellyfinSessions()` logic from `session-poller.ts` into `jellyfin.ts`. Wrap it as the `pollSessions` method on the adapter object:

```typescript
  pollIntervalMs: 10_000,

  async pollSessions(config, userCred?) {
    // Move pollJellyfinSessions() body here
    // Convert JfSession objects to NexusSession[]
    // Use existing jfFetchUser helper for API calls
    // Return normalized NexusSession array
  },
```

Key translations:
- `JfSession.PlayState.PositionTicks / 10_000_000` → `positionSeconds`
- `item.RunTimeTicks / 10_000_000` → `durationSeconds`
- `JF_TYPE_MAP[item.Type]` → `mediaType`
- `TranscodingInfo` → `metadata.transcoding`, `metadata.videoCodec`, etc.
- `PlayState.IsPaused` → `state: 'paused'` / `'playing'`

Add `NexusSession` import:
```typescript
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, UserCredential, ExternalUser, NexusSession } from './types';
```

- [ ] **Step 2: Implement `pollSessions` on RomM adapter**

Move the `pollRommStatuses()` logic from `session-poller.ts` into `romm.ts`:

```typescript
  pollIntervalMs: 60_000,

  async pollSessions(config, userCred?) {
    // Move pollRommStatuses() body here
    // Convert RomM game status objects to NexusSession[]
    // Map RomM status strings to NexusSession state
    // Return normalized NexusSession array
  },
```

Key translations:
- RomM `playing` status → `state: 'playing'`
- RomM `finished`/`completed` → `state: 'stopped'`
- RomM `rom.name || rom.fs_name_no_ext` → `mediaTitle`
- RomM genre extraction → `metadata` (optional)

- [ ] **Step 3: Rewrite `session-poller.ts` to be adapter-agnostic**

Replace the Jellyfin/RomM-specific code (~286 lines) with a generic loop (~40 lines):

```typescript
import { getEnabledConfigs, resolveUserCred } from './services';
import { registry } from '$lib/adapters/registry';
import type { NexusSession } from '$lib/adapters/types';

const previousSessions = new Map<string, Map<string, NexusSession>>();
const pollTimers = new Map<string, ReturnType<typeof setInterval>>();

export function startSessionPoller() {
  const configs = getEnabledConfigs();
  for (const config of configs) {
    const adapter = registry.get(config.type);
    if (!adapter?.pollSessions) continue;

    const intervalMs = adapter.pollIntervalMs ?? 10_000;
    const timer = setInterval(async () => {
      try {
        const userCred = resolveUserCred(config);
        const sessions = await adapter.pollSessions!(config, userCred);
        diffAndEmit(config.id, sessions);
      } catch (e) {
        // Log but don't crash the poller
        console.error(`[session-poller] ${config.type} error:`, e instanceof Error ? e.message : e);
      }
    }, intervalMs);

    if (timer.unref) timer.unref();
    pollTimers.set(config.id, timer);
  }
}

function diffAndEmit(serviceId: string, current: NexusSession[]) {
  const prev = previousSessions.get(serviceId) ?? new Map();
  const next = new Map(current.map((s) => [s.sessionId, s]));

  // Detect play/pause/resume/stop by comparing previous vs current state
  // Emit events via existing emitMediaEvent() calls
  // ... (keep existing diff/emit logic, just operating on NexusSession instead of JfSession)

  previousSessions.set(serviceId, next);
}

export function stopSessionPoller() {
  for (const timer of pollTimers.values()) clearInterval(timer);
  pollTimers.clear();
}
```

Keep the existing `emitMediaEvent()` calls and event diffing logic — just change the input type from `JfSession`/RomM objects to `NexusSession`.

- [ ] **Step 4: Delete dead Jellyfin/RomM types from session-poller.ts**

Remove: `JfSession` interface, `JF_TYPE_MAP`, `extractMetadata()`, `pollJellyfinSessions()`, `pollRommStatuses()`, RomM poll throttling.

- [ ] **Step 5: Verify type check**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same error count as before.

- [ ] **Step 6: Test manually**

Run: `pnpm dev`
Verify session polling still works: play something in Jellyfin, check that the admin dashboard shows the active session.

- [ ] **Step 7: Commit**

```bash
git add src/lib/adapters/jellyfin.ts src/lib/adapters/romm.ts src/lib/server/session-poller.ts
git commit -m "refactor: move session polling into adapter pollSessions methods"
```

---

## Task 5: Migrate Media Sync to Adapter Method

**Files:**
- Modify: `src/lib/adapters/jellyfin.ts`
- Modify: `src/lib/server/media-sync.ts`

- [ ] **Step 1: Implement `syncLibraryItems` on Jellyfin adapter**

Move `JellyfinItem` interface, `jellyfinTypeToLocal()`, and `fetchJellyfinItems()` from `media-sync.ts` into `jellyfin.ts`. Wrap as `syncLibraryItems`:

```typescript
  async syncLibraryItems(config, userCred?) {
    const userId = await getUserId(config, userCred);
    // Fetch all items using existing jfFetchUser with /Items endpoint
    // Convert to SyncItem[] using existing normalization logic
    // Return array of SyncItem
  },
```

Key translations:
- `item.RunTimeTicks / 10_000_000` → `duration` (seconds)
- `item.ProviderIds?.Tmdb` → `tmdbId`
- `item.ProviderIds?.Imdb` → `imdbId`
- Image URLs constructed with `posterUrl()` / `backdropUrl()` helpers already in the file

Add `SyncItem` to the import from types.

- [ ] **Step 2: Rewrite `media-sync.ts` to be adapter-agnostic**

Replace 169 lines of Jellyfin-specific code with ~50 lines:

```typescript
import { getEnabledConfigs } from './services';
import { registry } from '$lib/adapters/registry';
import { getRawDb } from '$lib/db';
import type { SyncItem } from '$lib/adapters/types';

export async function syncAllMedia(): Promise<number> {
  const configs = getEnabledConfigs();
  let totalSynced = 0;

  for (const config of configs) {
    const adapter = registry.get(config.type);
    if (!adapter?.syncLibraryItems) continue;

    try {
      const items = await adapter.syncLibraryItems(config);
      upsertSyncItems(config.id, config.type, items);
      totalSynced += items.length;
    } catch (e) {
      console.error(`[media-sync] ${config.type} error:`, e instanceof Error ? e.message : e);
    }
  }

  return totalSynced;
}

function upsertSyncItems(serviceId: string, serviceType: string, items: SyncItem[]) {
  // Keep existing upsert logic from upsertMediaItems()
  // Just change the input type from JellyfinItem to SyncItem
  const raw = getRawDb();
  const upsert = raw.prepare(`
    INSERT OR REPLACE INTO media_items (source_id, service_id, service_type, title, sort_title, media_type, year, genres, poster, backdrop, duration, rating, tmdb_id, imdb_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = raw.transaction(() => {
    for (const item of items) {
      upsert.run(
        item.sourceId, serviceId, serviceType,
        item.title, item.sortTitle ?? item.title, item.mediaType,
        item.year ?? null, JSON.stringify(item.genres ?? []),
        item.poster ?? null, item.backdrop ?? null,
        item.duration ?? null, item.rating ?? null,
        item.tmdbId ?? null, item.imdbId ?? null,
        Date.now()
      );
    }
  });
  tx();
}
```

- [ ] **Step 3: Delete dead Jellyfin types from media-sync.ts**

Remove: `JellyfinItem` interface, `jellyfinTypeToLocal()`, `fetchJellyfinItems()`, hardcoded `/Items` endpoint call.

- [ ] **Step 4: Verify type check**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same error count.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapters/jellyfin.ts src/lib/server/media-sync.ts
git commit -m "refactor: move media sync into adapter syncLibraryItems method"
```

---

## Task 6: Migrate Image Proxy Auth to Adapter Method

**Files:**
- Modify: `src/lib/adapters/jellyfin.ts`
- Modify: `src/lib/adapters/romm.ts`
- Modify: `src/lib/adapters/calibre.ts`
- Modify: `src/routes/api/media/image/+server.ts`

- [ ] **Step 1: Implement `getImageHeaders` on each adapter**

**jellyfin.ts:**
```typescript
  async getImageHeaders(config) {
    return { 'X-Emby-Token': config.apiKey ?? '' };
  },
```

**romm.ts:**
```typescript
  async getImageHeaders(config) {
    const creds = btoa(`${config.username}:${config.password}`);
    return { Authorization: `Basic ${creds}` };
  },
```

**calibre.ts:**
```typescript
  async getImageHeaders(config) {
    const session = await getSession(config);
    if (!session) return {};
    return { Cookie: session };
  },
```

- [ ] **Step 2: Update image proxy route**

Read `src/routes/api/media/image/+server.ts`, then replace the service-type branching with:

```typescript
const adapter = registry.get(config.type);
const headers: Record<string, string> = {};
if (adapter?.getImageHeaders) {
  Object.assign(headers, await adapter.getImageHeaders(config));
}
```

Add import: `import { registry } from '$lib/adapters/registry';`
Remove the direct `getSession` import from calibre.

- [ ] **Step 3: Verify type check**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same error count.

- [ ] **Step 4: Test manually**

Run: `pnpm dev`
Verify images load correctly on the homepage for Jellyfin, RomM, and Calibre media.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapters/jellyfin.ts src/lib/adapters/romm.ts src/lib/adapters/calibre.ts src/routes/api/media/image/+server.ts
git commit -m "refactor: move image proxy auth into adapter getImageHeaders method"
```

---

## Task 7: Migrate Domain Routes to Use `mediaTypes` Filtering

**Files:**
- Modify: ~15 route files in `src/routes/videos/`, `src/routes/api/video/`
- Modify: ~8 route files in `src/routes/games/`, `src/routes/api/games/`
- Modify: ~6 route files in `src/routes/books/`, `src/routes/api/books/`
- Modify: `src/routes/movies/+page.server.ts`
- Modify: `src/routes/shows/+page.server.ts`
- Modify: `src/routes/music/` routes

This is a mechanical refactor. The pattern change is the same everywhere:

- [ ] **Step 1: Create a shared helper**

Add to `src/lib/server/services.ts`:

```typescript
/** Get enabled configs for adapters matching a media type */
export function getConfigsForMediaType(mediaType: string): ServiceConfig[] {
  return getEnabledConfigs().filter((c) => {
    const adapter = registry.get(c.type);
    return adapter?.mediaTypes?.includes(mediaType as any);
  });
}
```

- [ ] **Step 2: Replace hardcoded type checks in video routes**

For every file in `src/routes/videos/` and `src/routes/api/video/` that has:
```typescript
const configs = getEnabledConfigs().filter((c) => c.type === 'invidious');
```

Replace with:
```typescript
import { getConfigsForMediaType } from '$lib/server/services';
const configs = getConfigsForMediaType('video');
```

Files to update (find with `grep -r "c.type === 'invidious'" src/routes/`):
- `src/routes/videos/+page.server.ts`
- `src/routes/videos/history/+page.server.ts`
- `src/routes/videos/subscriptions/+page.server.ts`
- `src/routes/videos/playlists/+page.server.ts`
- `src/routes/videos/channel/[id]/+page.server.ts`
- `src/routes/api/video/trending/+server.ts`
- `src/routes/api/video/popular/+server.ts`
- `src/routes/api/video/suggestions/+server.ts`
- `src/routes/api/video/search/+server.ts`
- `src/routes/api/video/history/+server.ts`
- `src/routes/api/video/history/[id]/+server.ts`
- `src/routes/api/video/history/resolved/+server.ts`
- `src/routes/api/video/subscriptions/+server.ts`
- `src/routes/api/video/subscriptions/[ucid]/+server.ts`
- `src/routes/api/video/subscriptions/feed/+server.ts`
- `src/routes/api/video/channels/[id]/+server.ts`
- `src/routes/api/video/playlists/+server.ts`
- `src/routes/api/video/playlists/[id]/+server.ts`
- `src/routes/api/video/playlists/[id]/videos/+server.ts`
- `src/routes/api/video/progress/+server.ts`
- `src/routes/api/video/comments/[id]/+server.ts`
- `src/routes/api/video/recommendations/+server.ts`

- [ ] **Step 3: Replace hardcoded type checks in game routes**

Same pattern — replace `c.type === 'romm'` with `getConfigsForMediaType('game')`:
- `src/routes/games/+page.server.ts`
- `src/routes/games/stats/+page.server.ts`
- `src/routes/games/platform/[slug]/+page.server.ts`
- `src/routes/play/[id]/+page.server.ts`
- `src/routes/api/games/platforms/+server.ts`
- `src/routes/api/games/collections/+server.ts`
- `src/routes/api/games/collections/[id]/+server.ts`

- [ ] **Step 4: Replace hardcoded type checks in book routes**

Replace `c.type === 'calibre'` with `getConfigsForMediaType('book')`:
- `src/routes/books/+page.server.ts`
- `src/routes/books/read/[id]/+page.server.ts`
- `src/routes/api/books/categories/+server.ts`
- `src/routes/api/books/series/+server.ts`
- `src/routes/api/books/authors/+server.ts`
- `src/routes/api/books/[id]/download/[format]/+server.ts`
- `src/routes/api/books/[id]/toggle-read/+server.ts`
- `src/routes/api/books/[id]/read/+server.ts`
- `src/routes/api/books/[id]/progress/+server.ts`

- [ ] **Step 5: Replace hardcoded type checks in movie/show/music routes**

Replace `c.type === 'jellyfin'` with appropriate `getConfigsForMediaType()` calls:
- `src/routes/movies/+page.server.ts` — `getConfigsForMediaType('movie')`
- `src/routes/shows/+page.server.ts` — `getConfigsForMediaType('show')`
- Music routes — `getConfigsForMediaType('music')`

- [ ] **Step 6: Replace hardcoded type checks in request/overseerr routes**

Replace `c.type === 'overseerr'` with filtering by adapters that implement `getRequests`:
```typescript
const configs = getEnabledConfigs().filter((c) => {
  const adapter = registry.get(c.type);
  return !!adapter?.getRequests;
});
```

- [ ] **Step 7: Verify type check**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same error count.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/services.ts src/routes/
git commit -m "refactor: replace hardcoded service type checks with mediaTypes filtering in domain routes"
```

---

## Task 8: Migrate Direct Adapter Imports to Registry Calls (High-Value Routes)

**Files:**
- Modify: `src/routes/media/[type]/[id]/+page.server.ts`
- Modify: `src/routes/api/user/credentials/+server.ts`
- Modify: `src/routes/admin/+page.server.ts`
- Modify: `src/lib/server/music.ts`
- Modify: `src/lib/server/trailers.ts`
- Modify: `src/lib/server/video-notifications.ts`

This task converts the highest-impact direct imports to use the registry pattern. The remaining ~40 route files that use adapter-specific exported functions (getSubscriptions, getPlatforms, etc.) will be migrated in a future task when those functions are wrapped as adapter interface methods (getServiceData, getCategories, etc.).

- [ ] **Step 1: Migrate `media/[type]/[id]/+page.server.ts`**

Replace direct imports of `getSeasons`, `getSubtitleStatus`, `getItemSubtitleHistory`, `getRomSaves`, `getRomStates`, `getRomScreenshots`, `getRelatedBooks`, `getCalibreBookFormats` with registry-based calls.

Pattern for each:
```typescript
// OLD:
import { getSeasons } from '$lib/adapters/jellyfin';
const seasons = await getSeasons(config, seriesId, userCred);

// NEW:
const adapter = registry.get(config.type);
const seasons = adapter?.getSubItems ? await adapter.getSubItems(config, seriesId, 'season', {}, userCred) : null;
```

Note: This requires that the Jellyfin adapter implements `getSubItems` for seasons. Add a thin wrapper to `jellyfin.ts`:

```typescript
  async getSubItems(config, parentId, type, opts, userCred) {
    if (type === 'season') {
      const seasons = await getSeasons(config, parentId, userCred);
      return { items: seasons as unknown as UnifiedMedia[], total: seasons.length };
    }
    // ... other types as they're migrated
    return { items: [], total: 0 };
  },
```

Only implement the wrappers needed by the detail page for now. The old exported functions stay — they're called by the new adapter method internally.

- [ ] **Step 2: Migrate `services.ts` remaining type checks**

Replace `resolveUserCred` StreamyStats/Overseerr special cases, `needsAutoLink`, and `autoLinkJellyfinServices` to use `adapter.authVia` instead of hardcoded type names.

- [ ] **Step 3: Migrate `music.ts`**

Replace `getJellyfinMusicConfigs()` and `getLidarrConfig()` with:
```typescript
const musicConfigs = getConfigsForMediaType('music');
```

Replace direct imports of `getAlbums`, `getArtists`, etc. with registry calls.

- [ ] **Step 4: Migrate `trailers.ts`**

Replace `configs.find((c) => c.type === 'invidious')` with:
```typescript
const videoConfigs = getConfigsForMediaType('video');
const config = videoConfigs[0];
```

- [ ] **Step 5: Migrate `video-notifications.ts`**

Replace `filter((c) => c.type === 'invidious')` with `getConfigsForMediaType('video')`.

- [ ] **Step 6: Verify type check**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same error count.

- [ ] **Step 7: Test manually**

Run: `pnpm dev`
Verify: media detail pages load, music plays, trailers resolve, video notifications work.

- [ ] **Step 8: Commit**

```bash
git add src/routes/ src/lib/server/ src/lib/adapters/
git commit -m "refactor: replace direct adapter imports with registry calls in core routes"
```

---

## Task 9: Update CONTRIBUTING.md with Adapter Guide

**Files:**
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Add adapter development section**

Add a section to `CONTRIBUTING.md` after "Adding a Service Adapter":

```markdown
## How Adapters Work

Nexus uses a plugin-like adapter system. The adapter handles all service-specific logic;
Nexus handles everything else (UI, caching, auth storage, analytics).

**What the adapter provides:**
- Connection (ping, API calls, auth headers)
- Data normalization (service-specific → UnifiedMedia)
- Capability declaration (isLibrary, isSearchable, mediaTypes, etc.)

**What Nexus provides automatically:**
- Service management UI (add/edit/remove)
- Health monitoring and recovery detection
- Per-user credential storage and account linking
- Dashboard, search, and media detail pages
- Image proxying and optimization
- Caching, rate limiting, and timeouts
- Analytics and recommendation engine

**Minimal adapter (3 required fields + ping):**

\`\`\`typescript
export const myAdapter: ServiceAdapter = {
  id: 'my-service',
  displayName: 'My Service',
  defaultPort: 8080,
  color: '#ff6600',
  abbreviation: 'MS',
  mediaTypes: ['movie', 'show'],
  isLibrary: true,
  isSearchable: true,
  searchPriority: 1,

  async ping(config) { /* health check */ },
  async search(config, query, userCred) { /* search */ },
  async getLibrary(config, opts, userCred) { /* browse */ },
};
\`\`\`

Register in `src/lib/adapters/registry.ts` and it's live — no other files to touch.
```

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add adapter development guide to CONTRIBUTING.md"
```

---

## Task Summary

| Task | What it does | Lines removed | Lines added | Risk |
|------|-------------|---------------|-------------|------|
| 1 | Interface + types | 0 | ~100 | None (additive) |
| 2 | Capability metadata on adapters | 0 | ~33 | None (additive) |
| 3 | services.ts uses capabilities | ~20 | ~25 | Medium |
| 4 | Session poller → adapter | ~286 | ~80 | High |
| 5 | Media sync → adapter | ~169 | ~60 | High |
| 6 | Image proxy → adapter | ~15 | ~15 | Low |
| 7 | Domain routes mediaTypes | ~60 | ~60 | Medium |
| 8 | Direct imports → registry | ~30 | ~40 | Medium |
| 9 | Docs | 0 | ~40 | None |
