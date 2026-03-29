# *arr API Phase 1: Calendar, Quality Badges, Download Queue

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add calendar aggregation (upcoming releases from Radarr/Sonarr/Lidarr), quality badges (4K/HDR/Atmos from *arr quality profiles), and an expanded download queue dashboard.

**Architecture:** Each feature adds a method to the relevant adapter(s), an API route for the frontend, and UI components. All data flows through the existing adapter registry — no hardcoded service types.

**Tech Stack:** SvelteKit, TypeScript, Vitest, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-03-29-arr-api-features-design.md` (Phase 1 section)

**UI Note:** Tasks that create visual components will include mockup options for user review before implementation.

---

## File Structure

```
src/lib/adapters/
  base.ts                          # Add getCalendar to interface
  types.ts                         # CalendarItem already exists; add QueueItem, QualityInfo
  radarr.ts                        # Add getCalendar, enrichItem (quality), expand getQueue
  sonarr.ts                        # Add getCalendar, enrichItem (quality), expand getQueue
  lidarr.ts                        # Add getCalendar, enrichItem (quality), add getQueue

src/routes/api/
  calendar/+server.ts              # GET — aggregated calendar
  admin/downloads/+server.ts       # GET — aggregated download queue
  admin/downloads/[serviceId]/[queueId]/+server.ts  # POST — retry/remove/blocklist

src/lib/components/
  QualityBadge.svelte              # Renders quality pills (4K, HDR, Atmos, FLAC)
  CalendarRow.svelte               # Homepage "Coming This Week" row
  DownloadQueue.svelte             # Admin downloads panel

src/routes/
  calendar/+page.svelte            # Calendar page (week/month view)
  calendar/+page.server.ts         # Calendar page data loader
```

---

## Task 1: Add `getCalendar` to Adapter Interface + Types

**Files:**
- Modify: `src/lib/adapters/base.ts`
- Modify: `src/lib/adapters/types.ts`

- [ ] **Step 1: Add `getCalendar` method to ServiceAdapter interface**

In `src/lib/adapters/base.ts`, add after the `getSeasonEpisodes` method (before the request management section):

```typescript
  /** Upcoming media releases within a date range */
  getCalendar?(config: ServiceConfig, start: string, end: string,
    userCred?: UserCredential): Promise<CalendarItem[]>;
```

Add `CalendarItem` to the import from `./types`:
```typescript
import type { ..., CalendarItem } from './types';
```

- [ ] **Step 2: Add `QualityInfo` and `QueueItem` types to types.ts**

Append to `src/lib/adapters/types.ts`:

```typescript
/** Quality metadata enrichment for media items */
export interface QualityInfo {
  resolution?: string;
  hdr?: string;
  audioFormat?: string;
  audioChannels?: string;
  videoCodec?: string;
  source?: string;
  customFormats?: string[];
  qualityProfile?: string;
}

/** Extended queue item with download progress metadata */
export interface QueueItemMeta {
  queueStatus: 'downloading' | 'paused' | 'queued' | 'failed' | 'warning' | 'completed';
  downloadProgress: number;
  sizeBytes?: number;
  remainingBytes?: number;
  eta?: string;
  downloadClient?: string;
  indexer?: string;
  quality?: string;
  errorMessage?: string;
}
```

- [ ] **Step 3: Run type check**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same count as before.

- [ ] **Step 4: Commit**

```bash
git add src/lib/adapters/base.ts src/lib/adapters/types.ts
git commit -m "feat: add getCalendar, QualityInfo, QueueItemMeta to adapter interface"
```

---

## Task 2: Implement `getCalendar` on Radarr, Sonarr, Lidarr

**Files:**
- Modify: `src/lib/adapters/radarr.ts`
- Modify: `src/lib/adapters/sonarr.ts`
- Modify: `src/lib/adapters/lidarr.ts`

- [ ] **Step 1: Implement `getCalendar` on Radarr**

In `src/lib/adapters/radarr.ts`, add `CalendarItem` to the import from `./types`, then add to the adapter object:

```typescript
  async getCalendar(config, start, end) {
    try {
      const data = await radarrFetch(config, `/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&unmonitored=false`);
      return (data ?? []).map((item: any): CalendarItem => {
        const releaseDate = item.digitalRelease ?? item.physicalRelease ?? item.inCinemas ?? '';
        return {
          id: `radarr-cal-${item.id}:${config.id}`,
          sourceId: String(item.tmdbId ?? item.id),
          serviceId: config.id,
          title: item.title ?? 'Unknown',
          mediaType: 'movie',
          releaseDate,
          poster: item.images?.find((i: any) => i.coverType === 'poster')?.remoteUrl,
          overview: item.overview,
          status: item.hasFile ? 'released' : 'upcoming'
        };
      });
    } catch {
      return [];
    }
  },
```

- [ ] **Step 2: Implement `getCalendar` on Sonarr**

In `src/lib/adapters/sonarr.ts`, add `CalendarItem` to imports, then add:

```typescript
  async getCalendar(config, start, end) {
    try {
      const data = await sonarrFetch(config, `/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&includeSeries=true&includeEpisodeFile=true&unmonitored=false`);
      return (data ?? []).map((ep: any): CalendarItem => {
        const season = String(ep.seasonNumber ?? 0).padStart(2, '0');
        const episode = String(ep.episodeNumber ?? 0).padStart(2, '0');
        const seriesTitle = ep.series?.title ?? '';
        return {
          id: `sonarr-cal-${ep.id}:${config.id}`,
          sourceId: String(ep.series?.tvdbId ?? ep.seriesId),
          serviceId: config.id,
          title: `${seriesTitle} S${season}E${episode}`,
          mediaType: 'show',
          releaseDate: ep.airDateUtc ?? '',
          poster: ep.series?.images?.find((i: any) => i.coverType === 'poster')?.remoteUrl,
          overview: ep.overview ?? ep.title,
          status: ep.hasFile ? 'released' : 'upcoming'
        };
      });
    } catch {
      return [];
    }
  },
```

- [ ] **Step 3: Implement `getCalendar` on Lidarr**

In `src/lib/adapters/lidarr.ts`, add `CalendarItem` to imports, then add:

```typescript
  async getCalendar(config, start, end) {
    try {
      const data = await lidarrFetch(config, `/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&unmonitored=false`);
      return (data ?? []).map((album: any): CalendarItem => {
        const artistName = album.artist?.artistName ?? '';
        return {
          id: `lidarr-cal-${album.id}:${config.id}`,
          sourceId: String(album.foreignAlbumId ?? album.id),
          serviceId: config.id,
          title: artistName ? `${artistName} — ${album.title}` : album.title ?? 'Unknown',
          mediaType: 'music',
          releaseDate: album.releaseDate ?? '',
          poster: album.images?.find((i: any) => i.coverType === 'cover')?.remoteUrl,
          overview: album.overview,
          status: album.statistics?.percentOfTracks === 100 ? 'released' : 'upcoming'
        };
      });
    } catch {
      return [];
    }
  },
```

- [ ] **Step 4: Run type check**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same count.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapters/radarr.ts src/lib/adapters/sonarr.ts src/lib/adapters/lidarr.ts
git commit -m "feat: implement getCalendar on Radarr, Sonarr, Lidarr adapters"
```

---

## Task 3: Calendar API Route

**Files:**
- Create: `src/routes/api/calendar/+server.ts`

- [ ] **Step 1: Create the calendar API route**

Create `src/routes/api/calendar/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';
import type { CalendarItem } from '$lib/adapters/types';

export const GET: RequestHandler = async ({ url }) => {
  const days = Math.min(parseInt(url.searchParams.get('days') ?? '7', 10), 90);
  const typesParam = url.searchParams.get('types');
  const allowedTypes = typesParam ? new Set(typesParam.split(',')) : null;

  const now = new Date();
  const start = now.toISOString();
  const end = new Date(now.getTime() + days * 86_400_000).toISOString();

  const items = await withCache(`calendar:${days}:${typesParam ?? 'all'}`, 300_000, async () => {
    const configs = getEnabledConfigs();
    const results: CalendarItem[] = [];

    await Promise.allSettled(
      configs.map(async (config) => {
        const adapter = registry.get(config.type);
        if (!adapter?.getCalendar) return;

        const calItems = await adapter.getCalendar(config, start, end);
        for (const item of calItems) {
          if (!allowedTypes || allowedTypes.has(item.mediaType)) {
            results.push(item);
          }
        }
      })
    );

    return results.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  });

  return json(items);
};
```

- [ ] **Step 2: Run type check**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same count.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/calendar/+server.ts
git commit -m "feat: add calendar API route aggregating releases from all *arr services"
```

---

## Task 4: Implement Quality Enrichment on Radarr, Sonarr, Lidarr

**Files:**
- Modify: `src/lib/adapters/radarr.ts`
- Modify: `src/lib/adapters/sonarr.ts`
- Modify: `src/lib/adapters/lidarr.ts`

- [ ] **Step 1: Add `enrichItem` for quality on Radarr**

Add `QualityInfo` to the import from `./types`. Add a module-level cache for quality profiles and custom formats:

```typescript
let radarrQualityCache: { profiles: any[]; formats: any[]; ts: number } | null = null;

async function getRadarrQualityMeta(config: ServiceConfig) {
  if (radarrQualityCache && Date.now() - radarrQualityCache.ts < 1_800_000) return radarrQualityCache;
  const [profiles, formats] = await Promise.all([
    radarrFetch(config, '/qualityprofile'),
    radarrFetch(config, '/customformat')
  ]);
  radarrQualityCache = { profiles, formats, ts: Date.now() };
  return radarrQualityCache;
}
```

Then add `enrichItem` to the adapter object:

```typescript
  async enrichItem(config, item, enrichmentType) {
    if (enrichmentType !== 'quality') return item;
    try {
      const radarrId = item.metadata?.radarrId;
      if (!radarrId) return item;
      const movie = await radarrFetch(config, `/movie/${radarrId}`);
      if (!movie?.movieFile) return item;

      const { profiles, formats } = await getRadarrQualityMeta(config);
      const profile = profiles.find((p: any) => p.id === movie.qualityProfileId);
      const mediaInfo = movie.movieFile.mediaInfo;
      const appliedFormats = movie.movieFile.customFormats ?? [];
      const formatNames = appliedFormats.map((f: any) => {
        const match = formats.find((cf: any) => cf.id === f.id);
        return match?.name ?? f.name;
      }).filter(Boolean);

      const quality: QualityInfo = {
        resolution: mediaInfo?.resolution,
        hdr: mediaInfo?.videoHdrFormat || undefined,
        audioFormat: mediaInfo?.audioCodec,
        audioChannels: mediaInfo?.audioChannels ? String(mediaInfo.audioChannels) : undefined,
        videoCodec: mediaInfo?.videoCodec,
        customFormats: formatNames.length > 0 ? formatNames : undefined,
        qualityProfile: profile?.name
      };

      return { ...item, metadata: { ...item.metadata, quality } };
    } catch {
      return item;
    }
  },
```

- [ ] **Step 2: Add `enrichItem` for quality on Sonarr**

Same pattern in `sonarr.ts` — cache quality profiles/custom formats, enrich episodes with quality info from episode files:

```typescript
let sonarrQualityCache: { profiles: any[]; formats: any[]; ts: number } | null = null;

async function getSonarrQualityMeta(config: ServiceConfig) {
  if (sonarrQualityCache && Date.now() - sonarrQualityCache.ts < 1_800_000) return sonarrQualityCache;
  const [profiles, formats] = await Promise.all([
    sonarrFetch(config, '/qualityprofile'),
    sonarrFetch(config, '/customformat')
  ]);
  sonarrQualityCache = { profiles, formats, ts: Date.now() };
  return sonarrQualityCache;
}
```

Add to adapter:

```typescript
  async enrichItem(config, item, enrichmentType) {
    if (enrichmentType !== 'quality') return item;
    try {
      const sonarrId = item.metadata?.sonarrId;
      if (!sonarrId) return item;
      const series = await sonarrFetch(config, `/series/${sonarrId}`);
      if (!series) return item;

      const { profiles, formats } = await getSonarrQualityMeta(config);
      const profile = profiles.find((p: any) => p.id === series.qualityProfileId);

      const quality: QualityInfo = {
        qualityProfile: profile?.name,
        customFormats: (series.customFormats ?? []).map((f: any) => {
          const match = formats.find((cf: any) => cf.id === f.id);
          return match?.name ?? f.name;
        }).filter(Boolean)
      };

      return { ...item, metadata: { ...item.metadata, quality } };
    } catch {
      return item;
    }
  },
```

- [ ] **Step 3: Add `enrichItem` for quality on Lidarr**

In `lidarr.ts`:

```typescript
let lidarrQualityCache: { profiles: any[]; ts: number } | null = null;

async function getLidarrQualityMeta(config: ServiceConfig) {
  if (lidarrQualityCache && Date.now() - lidarrQualityCache.ts < 1_800_000) return lidarrQualityCache;
  const profiles = await lidarrFetch(config, '/qualityprofile');
  lidarrQualityCache = { profiles, ts: Date.now() };
  return lidarrQualityCache;
}
```

Add to adapter:

```typescript
  async enrichItem(config, item, enrichmentType) {
    if (enrichmentType !== 'quality') return item;
    try {
      const lidarrId = item.metadata?.lidarrId;
      if (!lidarrId) return item;
      const album = await lidarrFetch(config, `/album/${lidarrId}`);
      if (!album) return item;

      const { profiles } = await getLidarrQualityMeta(config);
      const profile = profiles.find((p: any) => p.id === album.qualityProfileId);

      const quality: QualityInfo = {
        audioFormat: album.statistics?.trackFileCount > 0 ? 'FLAC' : undefined,
        qualityProfile: profile?.name
      };

      return { ...item, metadata: { ...item.metadata, quality } };
    } catch {
      return item;
    }
  },
```

- [ ] **Step 4: Run type check**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same count.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapters/radarr.ts src/lib/adapters/sonarr.ts src/lib/adapters/lidarr.ts
git commit -m "feat: implement quality enrichment on Radarr, Sonarr, Lidarr adapters"
```

---

## Task 5: Expand Download Queue with Rich Metadata

**Files:**
- Modify: `src/lib/adapters/radarr.ts`
- Modify: `src/lib/adapters/sonarr.ts`
- Modify: `src/lib/adapters/lidarr.ts`

- [ ] **Step 1: Expand Radarr `getQueue` with QueueItemMeta**

Replace the existing `getQueue` in `radarr.ts` with a richer version that includes `QueueItemMeta` in metadata:

```typescript
  async getQueue(config): Promise<UnifiedMedia[]> {
    try {
      const data = await radarrFetch(config, '/queue?page=1&pageSize=50&includeUnknownMovieItems=true&includeMovie=true');
      return (data?.records ?? []).map((r: any): UnifiedMedia => {
        const movie = r.movie ?? {};
        return {
          ...normalize(config, movie),
          metadata: {
            ...normalize(config, movie).metadata,
            queueStatus: r.status === 'completed' ? 'completed' : r.trackedDownloadStatus === 'warning' ? 'warning' : r.trackedDownloadState === 'downloading' ? 'downloading' : r.status === 'paused' ? 'paused' : r.trackedDownloadStatus === 'error' ? 'failed' : 'queued',
            downloadProgress: r.sizeleft != null && r.size ? Math.round(((r.size - r.sizeleft) / r.size) * 100) : 0,
            sizeBytes: r.size,
            remainingBytes: r.sizeleft,
            eta: r.estimatedCompletionTime,
            downloadClient: r.downloadClient,
            indexer: r.indexer,
            quality: r.quality?.quality?.name,
            errorMessage: r.statusMessages?.[0]?.messages?.[0]
          }
        };
      });
    } catch {
      return [];
    }
  },
```

- [ ] **Step 2: Expand Sonarr `getQueue` with QueueItemMeta**

Same pattern in `sonarr.ts`:

```typescript
  async getQueue(config): Promise<UnifiedMedia[]> {
    try {
      const data = await sonarrFetch(config, '/queue?page=1&pageSize=50&includeSeries=true&includeEpisode=true');
      return (data?.records ?? []).map((r: any): UnifiedMedia => {
        const series = r.series ?? {};
        const ep = r.episode ?? {};
        const season = String(ep.seasonNumber ?? 0).padStart(2, '0');
        const episode = String(ep.episodeNumber ?? 0).padStart(2, '0');
        return {
          ...normalize(config, series),
          title: `${series.title ?? 'Unknown'} S${season}E${episode}`,
          metadata: {
            ...normalize(config, series).metadata,
            queueStatus: r.status === 'completed' ? 'completed' : r.trackedDownloadStatus === 'warning' ? 'warning' : r.trackedDownloadState === 'downloading' ? 'downloading' : r.status === 'paused' ? 'paused' : r.trackedDownloadStatus === 'error' ? 'failed' : 'queued',
            downloadProgress: r.sizeleft != null && r.size ? Math.round(((r.size - r.sizeleft) / r.size) * 100) : 0,
            sizeBytes: r.size,
            remainingBytes: r.sizeleft,
            eta: r.estimatedCompletionTime,
            downloadClient: r.downloadClient,
            indexer: r.indexer,
            quality: r.quality?.quality?.name,
            errorMessage: r.statusMessages?.[0]?.messages?.[0]
          }
        };
      });
    } catch {
      return [];
    }
  },
```

- [ ] **Step 3: Add `getQueue` to Lidarr adapter**

In `lidarr.ts`, add to the adapter object:

```typescript
  async getQueue(config): Promise<UnifiedMedia[]> {
    try {
      const data = await lidarrFetch(config, '/queue?page=1&pageSize=50&includeAlbum=true&includeArtist=true');
      return (data?.records ?? []).map((r: any): UnifiedMedia => {
        const album = r.album ?? {};
        const artist = r.artist ?? album.artist ?? {};
        return {
          ...normalizeAlbum(config, { ...album, artist }),
          metadata: {
            ...normalizeAlbum(config, { ...album, artist }).metadata,
            queueStatus: r.status === 'completed' ? 'completed' : r.trackedDownloadStatus === 'warning' ? 'warning' : r.trackedDownloadState === 'downloading' ? 'downloading' : r.status === 'paused' ? 'paused' : r.trackedDownloadStatus === 'error' ? 'failed' : 'queued',
            downloadProgress: r.sizeleft != null && r.size ? Math.round(((r.size - r.sizeleft) / r.size) * 100) : 0,
            sizeBytes: r.size,
            remainingBytes: r.sizeleft,
            eta: r.estimatedCompletionTime,
            downloadClient: r.downloadClient,
            indexer: r.indexer,
            quality: r.quality?.quality?.name,
            errorMessage: r.statusMessages?.[0]?.messages?.[0]
          }
        };
      });
    } catch {
      return [];
    }
  },
```

- [ ] **Step 4: Run type check**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same count.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapters/radarr.ts src/lib/adapters/sonarr.ts src/lib/adapters/lidarr.ts
git commit -m "feat: expand download queue with rich metadata on Radarr, Sonarr, Lidarr"
```

---

## Task 6: Downloads API Route + Admin Actions

**Files:**
- Create: `src/routes/api/admin/downloads/+server.ts`
- Create: `src/routes/api/admin/downloads/[serviceId]/[queueId]/+server.ts`

- [ ] **Step 1: Create aggregated downloads endpoint**

Create `src/routes/api/admin/downloads/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

  const statusFilter = url.searchParams.get('status') ?? 'all';

  const items = await withCache(`admin-downloads:${statusFilter}`, 10_000, async () => {
    const configs = getEnabledConfigs();
    const all: any[] = [];

    await Promise.allSettled(
      configs.map(async (config) => {
        const adapter = registry.get(config.type);
        if (!adapter?.getQueue) return;
        const queue = await adapter.getQueue(config);
        for (const item of queue) {
          item.metadata = { ...item.metadata, serviceName: config.name };
          all.push(item);
        }
      })
    );

    // Sort: failed first, then by progress descending
    return all.sort((a, b) => {
      const aFailed = a.metadata?.queueStatus === 'failed' ? 0 : 1;
      const bFailed = b.metadata?.queueStatus === 'failed' ? 0 : 1;
      if (aFailed !== bFailed) return aFailed - bFailed;
      return (b.metadata?.downloadProgress ?? 0) - (a.metadata?.downloadProgress ?? 0);
    }).filter((item) => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'active') return ['downloading', 'queued', 'paused'].includes(item.metadata?.queueStatus);
      if (statusFilter === 'failed') return item.metadata?.queueStatus === 'failed';
      return true;
    });
  });

  return json(items);
};
```

- [ ] **Step 2: Create queue action endpoint**

Create `src/routes/api/admin/downloads/[serviceId]/[queueId]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceConfigs } from '$lib/server/services';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

  const { serviceId, queueId } = params;
  const config = getServiceConfigs().find((s) => s.id === serviceId);
  if (!config) return json({ error: 'Service not found' }, { status: 404 });

  const body = await request.json();
  const action = body.action as string;

  // Build *arr API URL — works for Radarr v3, Sonarr v3, Lidarr v1
  const apiVersion = config.type === 'lidarr' ? 'v1' : 'v3';
  const baseUrl = `${config.url}/api/${apiVersion}/queue/${queueId}`;

  try {
    if (action === 'retry') {
      // Radarr/Sonarr v3 don't have a retry endpoint — remove and re-add
      // For now, just remove without blocklist to trigger re-search
      const url = new URL(baseUrl);
      url.searchParams.set('apikey', config.apiKey ?? '');
      url.searchParams.set('removeFromClient', 'true');
      url.searchParams.set('blocklist', 'false');
      const res = await fetch(url.toString(), { method: 'DELETE', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`${res.status}`);
    } else if (action === 'remove') {
      const url = new URL(baseUrl);
      url.searchParams.set('apikey', config.apiKey ?? '');
      url.searchParams.set('removeFromClient', 'true');
      url.searchParams.set('blocklist', 'false');
      const res = await fetch(url.toString(), { method: 'DELETE', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`${res.status}`);
    } else if (action === 'blocklist') {
      const url = new URL(baseUrl);
      url.searchParams.set('apikey', config.apiKey ?? '');
      url.searchParams.set('removeFromClient', 'true');
      url.searchParams.set('blocklist', 'true');
      const res = await fetch(url.toString(), { method: 'DELETE', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`${res.status}`);
    } else {
      return json({ error: 'Unknown action' }, { status: 400 });
    }

    return json({ success: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
};
```

- [ ] **Step 3: Run type check**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Expected: Same count.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/admin/downloads/
git commit -m "feat: add admin downloads API with queue actions"
```

---

## Task 7: UI Components — Visual Design Review

**This task presents mockup options for user review before implementation.**

- [ ] **Step 1: Show quality badge mockup options**

Present 2-3 visual options for quality badges on media cards using the browser visual companion. Options should vary in:
- Pill style (filled vs outlined vs subtle)
- Color coding (per-badge-type vs monochrome vs service-brand-colored)
- Position on card (top-right overlay vs below title vs inline with metadata)

- [ ] **Step 2: Show calendar row mockup options**

Present 2-3 options for the "Coming This Week" homepage row:
- Card style (landscape timeline vs poster grid with date labels vs compact list)
- Date grouping (by day vs flat chronological)
- Media type indicators (color-coded dots vs icons vs text labels)

- [ ] **Step 3: Show download queue panel mockup options**

Present 2-3 options for the admin downloads panel:
- Layout (table vs card grid vs compact list)
- Progress visualization (bar vs percentage text vs circular)
- Action placement (inline buttons vs dropdown menu)

- [ ] **Step 4: Get user approval on visual direction**

Wait for user to select preferred style for each component before proceeding to implementation.

- [ ] **Step 5: Commit design decisions as notes**

Document chosen visual direction in the plan or a brief design note.

---

## Task 8: Implement QualityBadge Component

**Files:**
- Create: `src/lib/components/QualityBadge.svelte`

*Implementation details depend on visual direction chosen in Task 7.*

- [ ] **Step 1: Create `QualityBadge.svelte`**

Component accepts `quality: QualityInfo` prop and renders relevant pills. Only shows badges that have data — graceful degradation.

Key badges to render:
- Resolution: "4K" / "1080p" / "720p"
- HDR: "DV" (Dolby Vision) / "HDR10+" / "HDR10"
- Audio: "Atmos" / "DTS-X" / "TrueHD" / "FLAC"
- Source: "Remux" / "Blu-ray" / "WEB-DL"
- Custom formats: any additional tags from *arr

- [ ] **Step 2: Integrate into existing media card and detail components**

Add `QualityBadge` to the media card component and the media detail page. Pass `item.metadata?.quality` when available.

- [ ] **Step 3: Run type check + visual verification**

Run: `pnpm check 2>&1 | grep -c 'ERROR'`
Run: `pnpm dev` — verify badges appear on media cards for items with quality data.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/QualityBadge.svelte src/lib/components/ src/routes/
git commit -m "feat: add QualityBadge component with *arr quality enrichment"
```

---

## Task 9: Implement Calendar Page + Homepage Row

**Files:**
- Create: `src/routes/calendar/+page.server.ts`
- Create: `src/routes/calendar/+page.svelte`
- Modify: `src/routes/+page.svelte` (or homepage data loader)

*Visual implementation depends on Task 7 choices.*

- [ ] **Step 1: Create calendar page server loader**

```typescript
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, url }) => {
  const days = parseInt(url.searchParams.get('days') ?? '7', 10);
  const res = await fetch(`/api/calendar?days=${days}`);
  const items = res.ok ? await res.json() : [];

  // Group by date
  const byDate = new Map<string, typeof items>();
  for (const item of items) {
    const date = item.releaseDate.split('T')[0];
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(item);
  }

  return { items, byDate: Object.fromEntries(byDate), days };
};
```

- [ ] **Step 2: Create calendar page component**

Week/month view with day groupings, media type indicators, clickable items linking to detail pages.

- [ ] **Step 3: Add "Coming This Week" row to homepage**

In the homepage data loader, fetch `/api/calendar?days=7` and insert as a homepage row after continue watching (before trending).

- [ ] **Step 4: Commit**

```bash
git add src/routes/calendar/ src/routes/+page.svelte
git commit -m "feat: add calendar page and Coming This Week homepage row"
```

---

## Task 10: Implement Admin Downloads Panel

**Files:**
- Create: `src/lib/components/admin/DownloadQueue.svelte`
- Modify: `src/routes/admin/+page.svelte` (or admin layout)

*Visual implementation depends on Task 7 choices.*

- [ ] **Step 1: Create DownloadQueue component**

Table/list showing active downloads with:
- Title, service name, quality
- Progress bar with percentage
- ETA countdown
- Status icon (downloading/paused/failed/completed)
- Action buttons: retry, remove, blocklist (for failed items)
- Auto-refresh polling every 10s

- [ ] **Step 2: Integrate into admin dashboard**

Add DownloadQueue panel to the admin page, after the existing sessions panel.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/admin/DownloadQueue.svelte src/routes/admin/
git commit -m "feat: add admin download queue panel with actions"
```

---

## Task Summary

| Task | What it does | Risk |
|------|-------------|------|
| 1 | Interface + types | None (additive) |
| 2 | Calendar on 3 adapters | Low |
| 3 | Calendar API route | Low |
| 4 | Quality enrichment on 3 adapters | Low |
| 5 | Download queue expansion | Low |
| 6 | Downloads API + actions | Medium |
| 7 | Visual design review | None (design) |
| 8 | QualityBadge component | Low |
| 9 | Calendar page + homepage row | Medium |
| 10 | Admin downloads panel | Medium |
