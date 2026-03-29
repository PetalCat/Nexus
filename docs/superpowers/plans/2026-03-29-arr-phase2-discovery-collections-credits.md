# *arr Phase 2: Discovery, Collections, Credits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TMDB-powered discovery (trending, popular, upcoming, genre/network browsing), franchise collections, and person/credits pages via the Overseerr/Seerr API.

**Architecture:** Expand the Overseerr adapter's `discover()` method with more categories, add `getServiceData()` for person/credits and genre/network lists, add `getSubItems()` for collections. New API routes aggregate data. New Svelte pages render discovery grid, collection detail, and person filmography.

**Tech Stack:** SvelteKit, TypeScript, Overseerr API v1 (TMDB proxy)

**Spec:** `docs/superpowers/specs/2026-03-29-arr-api-features-design.md` (Phase 2)

---

## File Structure

```
src/lib/adapters/
  overseerr.ts                    # Expand discover(), add getServiceData(), getSubItems()

src/routes/api/
  discover/+server.ts             # Expand with genre/network/upcoming params
  discover/genres/+server.ts      # GET genre lists (movie + TV)
  collections/+server.ts          # GET all collections from Radarr
  collections/[id]/+server.ts     # GET single collection detail
  person/[id]/+server.ts          # GET person detail
  person/[id]/credits/+server.ts  # GET person filmography

src/routes/
  discover/+page.server.ts        # Discovery page data loader
  discover/+page.svelte           # Discovery page with tabs + infinite scroll
  collections/+page.server.ts     # Collections browse page
  collections/+page.svelte        # Collections grid
  collections/[id]/+page.server.ts # Collection detail page
  collections/[id]/+page.svelte   # Collection detail with movie grid
  person/[id]/+page.server.ts     # Person detail page
  person/[id]/+page.svelte        # Person page with filmography
```

---

## Task 1: Expand Overseerr Adapter — Discovery + Genres + Person + Collections

**Files:**
- Modify: `src/lib/adapters/overseerr.ts`
- Modify: `src/lib/adapters/radarr.ts`

- [ ] **Step 1: Expand `discover()` on Overseerr adapter**

Read `src/lib/adapters/overseerr.ts`. The adapter already has a `discover()` method with 3 categories (trending, movies, tv). Expand it to support more categories:

```typescript
async discover(config, opts?, userCred?) {
  const page = opts?.page ?? 1;
  const category = opts?.category ?? 'trending';
  try {
    let endpoint: string;
    switch (category) {
      case 'movies': endpoint = `/discover/movies?page=${page}`; break;
      case 'tv': endpoint = `/discover/tv?page=${page}`; break;
      case 'upcoming-movies': endpoint = `/discover/movies/upcoming?page=${page}`; break;
      case 'upcoming-tv': endpoint = `/discover/tv/upcoming?page=${page}`; break;
      case 'popular-movies': endpoint = `/discover/movies?page=${page}`; break;
      case 'popular-tv': endpoint = `/discover/tv?page=${page}`; break;
      case 'genre-movie': endpoint = `/discover/movies/genre/${opts?.genreId}?page=${page}`; break;
      case 'genre-tv': endpoint = `/discover/tv/genre/${opts?.genreId}?page=${page}`; break;
      case 'network': endpoint = `/discover/tv/network/${opts?.networkId}?page=${page}`; break;
      default: endpoint = `/discover/trending?page=${page}`;
    }
    const data = await osFetch(config, endpoint, userCred);
    return {
      items: (data.results ?? []).map((i: unknown) => normalize(config, i)),
      hasMore: page < (data.totalPages ?? 1)
    };
  } catch { return { items: [], hasMore: false }; }
},
```

Update the `discover` method signature's `opts` type to include `genreId` and `networkId`. In `base.ts`, the `discover` method opts already has `[key: string]: unknown` flexibility via the category string, but you may want to cast opts inline.

- [ ] **Step 2: Add `getServiceData()` to Overseerr for genres, person, recommendations**

```typescript
async getServiceData(config, dataType, params, userCred) {
  switch (dataType) {
    case 'genres-movie': {
      const data = await osFetch(config, '/genres/movie', userCred);
      return data;
    }
    case 'genres-tv': {
      const data = await osFetch(config, '/genres/tv', userCred);
      return data;
    }
    case 'person': {
      const data = await osFetch(config, `/person/${params?.personId}`, userCred);
      return data;
    }
    case 'person-credits': {
      const data = await osFetch(config, `/person/${params?.personId}/combined_credits`, userCred);
      return data;
    }
    case 'recommendations': {
      const mediaType = params?.mediaType ?? 'movie';
      const data = await osFetch(config, `/${mediaType}/${params?.tmdbId}/recommendations`, userCred);
      return (data?.results ?? []).map((i: unknown) => normalize(config, i));
    }
    case 'similar': {
      const mediaType = params?.mediaType ?? 'movie';
      const data = await osFetch(config, `/${mediaType}/${params?.tmdbId}/similar`, userCred);
      return (data?.results ?? []).map((i: unknown) => normalize(config, i));
    }
    default: return null;
  }
},
```

- [ ] **Step 3: Add `getSubItems()` to Radarr for collections**

In `src/lib/adapters/radarr.ts`, add:

```typescript
async getSubItems(config, parentId, type, opts, userCred) {
  if (type === 'collection') {
    if (!parentId) {
      // List all collections
      const data = await radarrFetch(config, '/collection');
      const items = (data ?? []).map((c: any): UnifiedMedia => ({
        id: `collection-${c.id}:${config.id}`,
        sourceId: String(c.tmdbId ?? c.id),
        serviceId: config.id,
        serviceType: 'radarr',
        type: 'movie',
        title: c.title ?? 'Unknown Collection',
        poster: c.images?.find((i: any) => i.coverType === 'poster')?.remoteUrl,
        backdrop: c.images?.find((i: any) => i.coverType === 'fanart')?.remoteUrl,
        metadata: {
          collectionId: c.id,
          tmdbId: c.tmdbId,
          movieCount: c.movies?.length ?? 0,
          missingMovies: c.movies?.filter((m: any) => !m.hasFile).length ?? 0
        }
      }));
      return { items, total: items.length };
    } else {
      // Get single collection detail
      const collections = await radarrFetch(config, '/collection');
      const collection = (collections ?? []).find((c: any) => String(c.tmdbId) === parentId || String(c.id) === parentId);
      if (!collection) return { items: [], total: 0 };
      const movies = (collection.movies ?? []).map((m: any) => normalize(config, m));
      return { items: movies, total: movies.length };
    }
  }
  return { items: [], total: 0 };
},
```

- [ ] **Step 4: Run type check**

Run: `pnpm check 2>&1 | grep -c ERROR`
Expected: Same count as before.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapters/overseerr.ts src/lib/adapters/radarr.ts
git commit -m "feat: expand Overseerr discovery + add person/genres/collections to adapters"
```

---

## Task 2: Discovery API Routes

**Files:**
- Modify: `src/routes/api/discover/+server.ts`
- Create: `src/routes/api/discover/genres/+server.ts`

- [ ] **Step 1: Expand existing discover API**

Update `src/routes/api/discover/+server.ts` to support the new categories:

```typescript
import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const category = url.searchParams.get('category') ?? 'trending';
  const genreId = url.searchParams.get('genreId') ?? undefined;
  const networkId = url.searchParams.get('networkId') ?? undefined;
  const userId = locals.user.id;

  const cacheKey = `discover:${category}:${genreId ?? ''}:${networkId ?? ''}:${page}`;

  const result = await withCache(cacheKey, 900_000, async () => {
    const configs = getEnabledConfigs().filter((c) => {
      const adapter = registry.get(c.type);
      return !!adapter?.discover;
    });

    let allItems: any[] = [];
    let hasMore = false;

    await Promise.allSettled(
      configs.map(async (config) => {
        const adapter = registry.get(config.type);
        if (!adapter?.discover) return;
        const cred = getUserCredentialForService(userId, config.id) ?? undefined;
        const res = await adapter.discover(config, { page, category, genreId, networkId }, cred);
        allItems.push(...(res?.items ?? []));
        if (res?.hasMore) hasMore = true;
      })
    );

    return { items: allItems, hasMore, page };
  });

  return json(result);
};
```

- [ ] **Step 2: Create genres endpoint**

Create `src/routes/api/discover/genres/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const type = url.searchParams.get('type') ?? 'movie';

  const genres = await withCache(`genres:${type}`, 3_600_000, async () => {
    const configs = getEnabledConfigs().filter((c) => {
      const adapter = registry.get(c.type);
      return !!adapter?.getServiceData;
    });

    for (const config of configs) {
      const adapter = registry.get(config.type);
      if (!adapter?.getServiceData) continue;
      const cred = getUserCredentialForService(locals.user!.id, config.id) ?? undefined;
      try {
        const data = await adapter.getServiceData(config, `genres-${type}`, {}, cred);
        if (data) return data;
      } catch { continue; }
    }
    return [];
  });

  return json(genres);
};
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/discover/
git commit -m "feat: expand discover API with genres, networks, upcoming categories"
```

---

## Task 3: Collections API Routes

**Files:**
- Create: `src/routes/api/collections/+server.ts`
- Create: `src/routes/api/collections/[id]/+server.ts`

- [ ] **Step 1: Create collections list endpoint**

```typescript
import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const collections = await withCache('collections:all', 1_800_000, async () => {
    const configs = getEnabledConfigs();
    const all: any[] = [];

    await Promise.allSettled(
      configs.map(async (config) => {
        const adapter = registry.get(config.type);
        if (!adapter?.getSubItems) return;
        try {
          const res = await adapter.getSubItems(config, '', 'collection', {});
          all.push(...(res?.items ?? []));
        } catch {}
      })
    );

    return all.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  });

  return json(collections);
};
```

- [ ] **Step 2: Create collection detail endpoint**

```typescript
import { json, error } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const collection = await withCache(`collection:${params.id}`, 1_800_000, async () => {
    const configs = getEnabledConfigs();

    for (const config of configs) {
      const adapter = registry.get(config.type);
      if (!adapter?.getSubItems) continue;
      try {
        const res = await adapter.getSubItems(config, params.id, 'collection', {});
        if (res && res.items.length > 0) return res;
      } catch {}
    }
    return null;
  });

  if (!collection) throw error(404, 'Collection not found');
  return json(collection);
};
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/collections/
git commit -m "feat: add collections API routes (list + detail)"
```

---

## Task 4: Person/Credits API Routes

**Files:**
- Create: `src/routes/api/person/[id]/+server.ts`
- Create: `src/routes/api/person/[id]/credits/+server.ts`

- [ ] **Step 1: Create person detail endpoint**

```typescript
import { json, error } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const person = await withCache(`person:${params.id}`, 3_600_000, async () => {
    const configs = getEnabledConfigs();
    for (const config of configs) {
      const adapter = registry.get(config.type);
      if (!adapter?.getServiceData) continue;
      const cred = getUserCredentialForService(locals.user!.id, config.id) ?? undefined;
      try {
        const data = await adapter.getServiceData(config, 'person', { personId: params.id }, cred);
        if (data) return data;
      } catch { continue; }
    }
    return null;
  });

  if (!person) throw error(404, 'Person not found');
  return json(person);
};
```

- [ ] **Step 2: Create person credits endpoint**

```typescript
import { json, error } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const credits = await withCache(`person-credits:${params.id}`, 1_800_000, async () => {
    const configs = getEnabledConfigs();
    for (const config of configs) {
      const adapter = registry.get(config.type);
      if (!adapter?.getServiceData) continue;
      const cred = getUserCredentialForService(locals.user!.id, config.id) ?? undefined;
      try {
        const data = await adapter.getServiceData(config, 'person-credits', { personId: params.id }, cred);
        if (data) return data;
      } catch { continue; }
    }
    return null;
  });

  if (!credits) throw error(404, 'Credits not found');
  return json(credits);
};
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/person/
git commit -m "feat: add person detail and credits API routes"
```

---

## Task 5: Visual Design Review

Present mockup options for:
- Discovery page layout (tabs, grid, filters)
- Collection detail page
- Person page with filmography

Get user approval before building UI.

---

## Task 6: Discovery Page

**Files:**
- Create: `src/routes/discover/+page.server.ts`
- Create: `src/routes/discover/+page.svelte`

- [ ] **Step 1: Create discovery page server loader**

Fetch initial data (trending + genre lists):

```typescript
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, url }) => {
  const category = url.searchParams.get('category') ?? 'trending';
  const genreId = url.searchParams.get('genreId') ?? '';
  const networkId = url.searchParams.get('networkId') ?? '';

  const [discoverRes, movieGenresRes, tvGenresRes] = await Promise.all([
    fetch(`/api/discover?category=${category}&genreId=${genreId}&networkId=${networkId}&page=1`),
    fetch('/api/discover/genres?type=movie'),
    fetch('/api/discover/genres?type=tv')
  ]);

  const discover = discoverRes.ok ? await discoverRes.json() : { items: [], hasMore: false };
  const movieGenres = movieGenresRes.ok ? await movieGenresRes.json() : [];
  const tvGenres = tvGenresRes.ok ? await tvGenresRes.json() : [];

  return { discover, movieGenres, tvGenres, category, genreId, networkId };
};
```

- [ ] **Step 2: Create discovery page component**

Build with:
- Category tabs: Trending, Movies, TV Shows, Upcoming
- Genre dropdown filter (populated from genres API)
- Infinite scroll (fetch next page on scroll bottom)
- Poster grid with title, year, rating, request status badge
- Click → media detail page
- "Request" button on items not in library
- Responsive: 2 cols mobile, 4 cols tablet, 6 cols desktop
- Use the `svelte-file-editor` agent for the Svelte component

- [ ] **Step 3: Commit**

```bash
git add src/routes/discover/
git commit -m "feat: add /discover page with category tabs, genre filtering, infinite scroll"
```

---

## Task 7: Collections Pages

**Files:**
- Create: `src/routes/collections/+page.server.ts`
- Create: `src/routes/collections/+page.svelte`
- Create: `src/routes/collections/[id]/+page.server.ts`
- Create: `src/routes/collections/[id]/+page.svelte`

- [ ] **Step 1: Create collections browse page**

Server loader fetches `/api/collections`. Page renders a poster grid of collections with title and movie count badge.

- [ ] **Step 2: Create collection detail page**

Server loader fetches `/api/collections/{id}`. Page renders:
- Hero section with collection backdrop
- Movie grid showing all movies in the collection
- Each movie shows availability status (available/missing/requested)
- "Request" button on missing movies

- [ ] **Step 3: Add "Part of {Collection}" to media detail page**

In `src/routes/media/[type]/[id]/+page.svelte`, check if the movie has a collection in its Radarr metadata. If so, show a banner linking to the collection page.

- [ ] **Step 4: Commit**

```bash
git add src/routes/collections/ src/routes/media/
git commit -m "feat: add /collections browse + detail pages, collection banner on media detail"
```

---

## Task 8: Person/Credits Pages

**Files:**
- Create: `src/routes/person/[id]/+page.server.ts`
- Create: `src/routes/person/[id]/+page.svelte`

- [ ] **Step 1: Create person detail page**

Server loader fetches `/api/person/{id}` and `/api/person/{id}/credits`. Page renders:
- Hero with profile photo, name, bio, known-for department, birthday
- Filmography grid: poster cards grouped by department (Acting, Directing, Writing)
- Each card shows title, year, role/job, availability status
- Sorted by popularity descending
- Click → media detail page
- Responsive layout

- [ ] **Step 2: Make cast names clickable on media detail page**

In `src/routes/media/[type]/[id]/+page.svelte`, wrap cast member names in `<a href="/person/{personId}">` links. The `personId` comes from the cast metadata (already includes TMDB person IDs from Overseerr/Jellyfin).

- [ ] **Step 3: Add "More from this Director" row**

On the media detail page, if the item has a director in cast metadata, fetch their credits and show a horizontal row of their other movies/shows.

- [ ] **Step 4: Commit**

```bash
git add src/routes/person/ src/routes/media/
git commit -m "feat: add /person page with filmography, clickable cast, director row"
```

---

## Task 9: Homepage Discovery Rows

**Files:**
- Modify: `src/routes/+page.server.ts`
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Add upcoming rows to homepage**

In the homepage server loader, fetch upcoming movies and TV from the discover API and add them as homepage rows after the calendar row:

```typescript
const [upcomingMoviesRes, upcomingTvRes] = await Promise.all([
  fetch('/api/discover?category=upcoming-movies&page=1'),
  fetch('/api/discover?category=upcoming-tv&page=1')
]);
```

Add as rows with titles "Upcoming Movies" and "Upcoming Shows".

- [ ] **Step 2: Commit**

```bash
git add src/routes/+page.server.ts src/routes/+page.svelte
git commit -m "feat: add Upcoming Movies and Upcoming Shows rows to homepage"
```

---

## Task Summary

| Task | What it does | Risk |
|------|-------------|------|
| 1 | Expand Overseerr + Radarr adapters | Low |
| 2 | Discovery API routes | Low |
| 3 | Collections API routes | Low |
| 4 | Person/credits API routes | Low |
| 5 | Visual design review | None |
| 6 | /discover page | Medium |
| 7 | /collections pages + media detail integration | Medium |
| 8 | /person page + clickable cast + director row | Medium |
| 9 | Homepage discovery rows | Low |
