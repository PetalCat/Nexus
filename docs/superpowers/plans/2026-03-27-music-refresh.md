# Music Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the music experience with real audio playback, a persistent floating MusicPill, 9 music routes, Now Playing overlay with morph animation, and smart media conflict handling.

**Architecture:** Four phases: (1) Core — musicStore rewrite for real `<audio>`, MusicPill wiring, media conflicts; (2) Music Hub — sub-layout with nav, home, albums, artists, songs pages; (3) Detail & Discovery — album detail, artist detail, search, playlists, wanted; (4) Polish — Now Playing overlay, Command Palette integration, final testing.

**Tech Stack:** SvelteKit 5 (runes), Jellyfin audio streaming (existing proxy), Svelte 5 stores, Nexus design tokens.

**Spec:** `docs/superpowers/specs/2026-03-27-music-refresh-design.md`

**Mockup:** `.superpowers/brainstorm/71353-1774589505/music-pages.html`

---

## File Structure

### New Files
```
src/routes/music/+layout.svelte                    — music sub-layout with nav bar
src/routes/music/albums/+page.svelte                — albums grid
src/routes/music/albums/+page.server.ts             — albums data
src/routes/music/albums/[id]/+page.svelte           — album detail
src/routes/music/albums/[id]/+page.server.ts        — album detail data
src/routes/music/artists/+page.svelte               — artists grid
src/routes/music/artists/+page.server.ts            — artists data
src/routes/music/artists/[id]/+page.svelte          — artist detail
src/routes/music/artists/[id]/+page.server.ts       — artist detail data
src/routes/music/songs/+page.svelte                 — songs table
src/routes/music/songs/+page.server.ts              — songs data
src/routes/music/playlists/+page.svelte             — playlists grid
src/routes/music/playlists/+page.server.ts          — playlists data
src/routes/music/wanted/+page.svelte                — lidarr wanted/queue
src/routes/music/wanted/+page.server.ts             — wanted data
src/routes/music/search/+page.svelte                — dedicated search
src/routes/music/search/+page.server.ts             — search data
src/lib/components/music/NowPlayingOverlay.svelte   — full-screen now playing
src/lib/components/music/QueuePanel.svelte          — slide-in queue manager
src/lib/components/music/MusicNav.svelte            — music sub-navigation bar
src/lib/components/music/AlbumCard.svelte           — album card with hover play
src/lib/components/music/ArtistCard.svelte          — circular artist avatar card
```

### Modified Files
```
src/lib/stores/musicStore.svelte.ts                 — rewrite: real <audio>, Track type update, collapse/expand, media conflict API, play session tracking
src/lib/components/music/MusicPill.svelte           — wire to real audio, add click-to-open Now Playing
src/routes/+layout.svelte                           — mount MusicPill
src/lib/components/Player.svelte                    — add pauseForMedia/resumeAfterMedia calls
src/lib/components/CommandPalette.svelte             — add music search results with play action
src/lib/server/music.ts                             — add getMusicSongs(), getArtistTopSongs(), hydrate recently played
src/routes/music/+page.svelte                       — rewrite as music home
src/routes/music/+page.server.ts                    — rewrite with home data (recently played, new albums, artists)
```

---

## Phase 1: Core Audio Infrastructure

### Task 1: Rewrite musicStore for Real Audio

**Files:**
- Modify: `src/lib/stores/musicStore.svelte.ts`

- [ ] **Step 1: Update Track interface**

Add `serviceId` and `sourceId` to the Track type:
```typescript
export interface Track {
  id: string;           // composite ID for consistency with UnifiedMedia
  sourceId: string;     // raw Jellyfin item ID (used in stream URLs)
  serviceId: string;    // which Jellyfin service
  title: string;
  artist: string;
  album: string;
  albumId: string;
  duration: number;
  image: string;
}
```

- [ ] **Step 2: Replace simulated timer with real `<audio>` element**

Remove the `startPlayback()`/`stopPlayback()` interval timer (lines ~65-86). Replace with:

```typescript
import { browser } from '$app/environment';

let audioElement: HTMLAudioElement;
let _loading = $state(false);
let _wasPausedByMedia = $state(false);
let _collapsed = $state(false);

function initAudio() {
  if (!browser) return;
  audioElement = new Audio();
  audioElement.volume = _volume;
  audioElement.addEventListener('timeupdate', () => {
    _currentTime = audioElement.currentTime;
    _progress = audioElement.duration ? audioElement.currentTime / audioElement.duration : 0;
  });
  audioElement.addEventListener('ended', () => skipNext());
  audioElement.addEventListener('loadstart', () => { _loading = true; });
  audioElement.addEventListener('canplay', () => { _loading = false; });
  audioElement.addEventListener('error', (e) => { console.error('[music] Audio error:', e); _loading = false; });
}

if (browser) initAudio();
```

- [ ] **Step 3: Update playback functions to use real audio**

Replace `startPlayback()` calls with actual audio loading:

```typescript
function loadAndPlay(track: Track) {
  if (!audioElement) return;
  // The stream proxy adds Jellyfin auth. We add codec params for browser compatibility.
  const streamUrl = `/api/stream/${track.serviceId}/audio/${track.sourceId}/universal?Container=opus,mp3,aac&AudioCodec=opus&TranscodingContainer=ts&MaxStreamingBitrate=320000`;
  audioElement.src = streamUrl;
  audioElement.play().catch(e => console.error('[music] Play failed:', e));
  _playing = true;
  _visible = true;
  _collapsed = false;
  updateMediaSession(track);
}
```

Update `togglePlay()` to use `audioElement.play()`/`audioElement.pause()`.
Update `seek()` to set `audioElement.currentTime = fraction * audioElement.duration`.
Update `setVolume()` to set `audioElement.volume = v`.
Update `toggleMute()` to set `audioElement.muted`.

- [ ] **Step 4: Add MediaSession API**

```typescript
function updateMediaSession(track: Track) {
  if (!browser || !('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: [{ src: track.image, sizes: '512x512', type: 'image/jpeg' }]
  });
  navigator.mediaSession.setActionHandler('play', () => togglePlay());
  navigator.mediaSession.setActionHandler('pause', () => togglePlay());
  navigator.mediaSession.setActionHandler('previoustrack', () => skipPrev());
  navigator.mediaSession.setActionHandler('nexttrack', () => skipNext());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime != null && audioElement) audioElement.currentTime = details.seekTime;
  });
}
```

- [ ] **Step 5: Add media conflict API**

```typescript
function pauseForMedia() {
  if (_playing && audioElement) {
    _wasPausedByMedia = true;
    audioElement.pause();
    _playing = false;
    _collapsed = true;
  }
}

function resumeAfterMedia() {
  if (_wasPausedByMedia && audioElement) {
    _wasPausedByMedia = false;
    _collapsed = false;
    audioElement.play().catch(() => {});
    _playing = true;
  }
}

function collapse() { _collapsed = true; }
function expand() { _collapsed = false; }
```

Export `pauseForMedia`, `resumeAfterMedia`, `collapse`, `expand`. Add `collapsed` and `loading` to the `musicPlayer` getter object.

- [ ] **Step 6: Add play session reporting**

```typescript
function reportPlayStart(track: Track) {
  if (!browser) return;
  fetch('/api/ingest/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mediaId: track.sourceId,
      serviceId: track.serviceId,
      mediaType: 'music',
      source: 'reader'
    })
  }).catch(() => {});
}
```

Call `reportPlayStart(track)` in `loadAndPlay()`.

- [ ] **Step 7: Remove deprecated code and fix dependents**

Remove: `allAlbumTracks`, `setTrackLibrary()`, `getTracksForAlbum()`, `getAllTracks()`, `getRecommendedTracks()`, the interval-based `startPlayback()`/`stopPlayback()`.

**Also rewrite `playAlbum()`** — it currently calls the deleted `getTracksForAlbum()`. Change it to accept tracks as a parameter:
```typescript
function playAlbum(tracks: Track[], startIndex = 0) {
  if (!tracks.length) return;
  setQueue(tracks, startIndex);
}
```

**Also fix `flow` queue mode** — `skipNext()` calls `getRecommendedTracks()` which is being removed. Replace with a stub that fetches instant mix from the API:
```typescript
// In skipNext() flow mode branch:
fetch(`/api/music/instant-mix/${currentTrack.sourceId}?service=${currentTrack.serviceId}`)
  .then(r => r.json())
  .then(items => { /* convert to Track[], add to queue */ })
  .catch(() => { /* stop playback */ });
```

**Remove client-side liked/playlist state** — `_likedSongs`, `_playlists`, and their client-side CRUD functions overlap with the server-side DB operations in `server/music.ts`. Remove the client-side versions. The pages will fetch liked/playlist state from the server. Keep only `toggleLikeTrack` as a function that calls the `/api/music/liked` endpoint.

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/musicStore.svelte.ts
git commit -m "feat(music): rewrite musicStore with real <audio> element and MediaSession API"
```

---

### Task 2: Wire MusicPill into Root Layout

**Files:**
- Modify: `src/routes/+layout.svelte`
- Modify: `src/lib/components/music/MusicPill.svelte`

- [ ] **Step 1: Add MusicPill import to layout**

In `src/routes/+layout.svelte`, add the import alongside other global components (NotificationPanel, CommandPalette, ToastContainer):

```typescript
import MusicPill from '$lib/components/music/MusicPill.svelte';
import { musicPlayer } from '$lib/stores/musicStore.svelte';
```

Add the component in the template, after the main content area and before the closing tags:

```svelte
{#if musicPlayer.visible && musicPlayer.currentTrack && !musicPlayer.collapsed}
  <MusicPill />
{/if}
```

- [ ] **Step 2: Update MusicPill to use real audio state**

Read `MusicPill.svelte` first. The component already imports from `musicStore.svelte` and uses `musicPlayer` getters. Since we updated the store to use real audio, the getters (`playing`, `progress`, `currentTime`, `volume`, etc.) should already reflect real audio state. Verify no references to the old simulated timer remain.

If MusicPill references `musicPlayer.expanded` for its hover state, that's fine — it's local UI state, not playback state.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/+layout.svelte" src/lib/components/music/MusicPill.svelte
git commit -m "feat(music): wire MusicPill into root layout"
```

---

### Task 3: Media Conflict Handling in Player.svelte

**Files:**
- Modify: `src/lib/components/Player.svelte`

- [ ] **Step 1: Import music conflict functions**

At the top of Player.svelte (2150 lines — this is an existing file, make targeted additions only):

```typescript
import { musicPlayer, pauseForMedia, resumeAfterMedia } from '$lib/stores/musicStore.svelte';
```

- [ ] **Step 2: Pause music when video starts**

Find where the video/HLS element starts playing (look for the `play` event handler or `autoplay` logic). Add:

```typescript
// When video playback begins
if (musicPlayer.playing) {
  pauseForMedia();
}
```

This should fire when the `<video>` element's `play` event fires or when HLS starts.

- [ ] **Step 3: Resume music when video ends/closes**

Find the close/cleanup logic (look for `onclose` callback, component destroy, or video `ended` event). Add:

```typescript
resumeAfterMedia();
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/Player.svelte
git commit -m "feat(music): pause/resume music on video playback conflict"
```

---

### Phase 1 Checkpoint

- [ ] **Verify dev server starts:** `pnpm dev` — no build errors
- [ ] **Verify MusicPill renders** when `musicPlayer.visible` is true
- [ ] **Verify audio plays** by manually setting a stream URL in the browser console

---

## Phase 2: Music Hub Pages

### Task 4: Music Sub-Layout and Navigation

**Files:**
- Create: `src/routes/music/+layout.svelte`
- Create: `src/lib/components/music/MusicNav.svelte`

- [ ] **Step 1: Create MusicNav.svelte**

Navigation bar component for music pages.

```typescript
interface Props {
  currentPath: string;
}
```

Links: Home (`/music`), Albums (`/music/albums`), Artists (`/music/artists`), Songs (`/music/songs`), Playlists (`/music/playlists`), Wanted (`/music/wanted`). Plus a search icon linking to `/music/search`.

Styling: sticky top, pill/chip buttons, active tab has `var(--color-accent)` highlight. Background with backdrop-filter blur. Match the mockup nav bar.

Use the `svelte-file-editor` agent.

- [ ] **Step 2: Create music +layout.svelte**

```svelte
<script lang="ts">
  import MusicNav from '$lib/components/music/MusicNav.svelte';
  import { page } from '$app/state';

  let { children } = $props();
</script>

<MusicNav currentPath={page.url.pathname} />
{@render children()}
```

Note: Svelte 5 uses `{@render children()}` instead of `<slot />`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/music/+layout.svelte src/lib/components/music/MusicNav.svelte
git commit -m "feat(music): music sub-layout with navigation bar"
```

---

### Task 5: Shared Music Card Components

**Files:**
- Create: `src/lib/components/music/AlbumCard.svelte`
- Create: `src/lib/components/music/ArtistCard.svelte`

- [ ] **Step 1: Create AlbumCard.svelte**

Reusable album card with hover play button.

```typescript
interface Props {
  album: UnifiedMedia;
  onplay?: () => void;
}
```

Features: square cover art (rounded-10px), album name + artist name below, gold play button on hover (opacity 0 → 1, translateY 6px → 0). Links to `/music/albums/${album.sourceId}?service=${album.serviceId}`. Play button calls `onplay` and stops event propagation.

Use Nexus design tokens. Match the mockup's album card style.

Use the `svelte-file-editor` agent.

- [ ] **Step 2: Create ArtistCard.svelte**

Circular artist avatar with name.

```typescript
interface Props {
  artist: { id: string; name: string; imageUrl?: string; albumCount?: number; serviceId?: string };
}
```

Note: `getArtists` in the Jellyfin adapter returns a custom shape, not `UnifiedMedia`. The component should accept this shape directly. Link to `/music/artists/${artist.id}?service=${artist.serviceId}`.

Features: circular image (border-radius 50%), artist name centered below, scale on hover, subtle shadow. Links to `/music/artists/${artist.sourceId}?service=${artist.serviceId}`.

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/music/AlbumCard.svelte src/lib/components/music/ArtistCard.svelte
git commit -m "feat(music): album and artist card components"
```

---

### Task 6: Music Home Page Rewrite

**Files:**
- Rewrite: `src/routes/music/+page.svelte`
- Rewrite: `src/routes/music/+page.server.ts`

- [ ] **Step 1: Rewrite +page.server.ts**

```typescript
import type { PageServerLoad } from './$types';
import { getMusicAlbums, getMusicArtists, getRecentlyPlayed } from '$lib/server/music';

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user?.id;
  if (!userId) return { recentlyPlayed: [], newAlbums: [], artists: [] };

  const [recentlyPlayed, albumsResult, artistsResult] = await Promise.all([
    getRecentlyPlayed(userId, 20),
    getMusicAlbums(userId, { sort: 'added', limit: 20 }),
    getMusicArtists(userId, { sort: 'SortName', limit: 20 })
  ]);

  return { recentlyPlayed, newAlbums: albumsResult.items, artists: artistsResult.items };
};
```

Note: `getRecentlyPlayed` returns basic records that may need hydration. If the returned data lacks album art/artist, the implementation should fetch item details from Jellyfin in a batch call. Check what `getRecentlyPlayed()` returns and adapt.

- [ ] **Step 2: Rewrite +page.svelte**

Music home page with:
1. Greeting header ("Good Morning/Afternoon/Evening" based on `new Date().getHours()`)
2. Recently played chips (2-column grid of compact cards with album art + title, click to play)
3. Recently Played row (horizontal scroll of AlbumCard components)
4. New in Your Library row (horizontal scroll of AlbumCards from `newAlbums`)
5. Your Artists row (horizontal scroll of ArtistCards)

Use `MediaRow` component for horizontal scroll rows if it supports custom cards, or build inline horizontal scroll with `overflow-x: auto; display: flex; gap: 14px;`.

Match the mockup home page design.

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/music/+page.svelte" "src/routes/music/+page.server.ts"
git commit -m "feat(music): music home page with recently played, new albums, artists"
```

---

### Task 7: Albums Page

**Files:**
- Create: `src/routes/music/albums/+page.svelte`
- Create: `src/routes/music/albums/+page.server.ts`

- [ ] **Step 1: Create +page.server.ts**

```typescript
import type { PageServerLoad } from './$types';
import { getMusicAlbums } from '$lib/server/music';

export const load: PageServerLoad = async ({ url, locals }) => {
  const userId = locals.user?.id;
  if (!userId) return { albums: [], genres: [] };

  const genre = url.searchParams.get('genre') ?? '';
  const sort = url.searchParams.get('sort') ?? 'DateCreated';
  const search = url.searchParams.get('q') ?? '';

  // NOTE: getMusicAlbums returns { items, total }. The sort keys map to Jellyfin:
  // 'title' → SortName, 'year' → ProductionYear, 'rating' → CommunityRating, 'added' → DateCreated
  const result = await getMusicAlbums(userId, {
    genre: genre || undefined,
    sort: sort || 'added',
    limit: 200
  });

  // Client-side search filter (adapter doesn't support search yet — extend if needed)
  let albums = result.items;
  if (search) {
    const q = search.toLowerCase();
    albums = albums.filter(a => a.title.toLowerCase().includes(q) || (a.metadata?.artist as string ?? '').toLowerCase().includes(q));
  }

  const genres = [...new Set(albums.flatMap(a => a.genres ?? []))].sort();
  return { albums, genres, currentGenre: genre, currentSort: sort, search };
};
```

- [ ] **Step 2: Create +page.svelte**

Albums page with:
- Filter bar: genre chips (All + genres from data) + search input (right-aligned)
- Sort: Recently Added, Title A-Z, Artist, Year
- Responsive grid of AlbumCard components
- Empty state if no albums

Match the mockup's albums grid with filter bar.

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/music/albums/+page.svelte" "src/routes/music/albums/+page.server.ts"
git commit -m "feat(music): albums grid page with genre filters and search"
```

---

### Task 8: Artists Page

**Files:**
- Create: `src/routes/music/artists/+page.svelte`
- Create: `src/routes/music/artists/+page.server.ts`

- [ ] **Step 1: Create +page.server.ts**

```typescript
import type { PageServerLoad } from './$types';
import { getMusicArtists } from '$lib/server/music';

export const load: PageServerLoad = async ({ url, locals }) => {
  const userId = locals.user?.id;
  if (!userId) return { artists: [] };

  const sort = url.searchParams.get('sort') ?? 'SortName';
  const search = url.searchParams.get('q') ?? '';

  // getMusicArtists returns { items, total }
  // NOTE: getArtists returns a custom shape { id, name, sortName, albumCount, imageUrl, ... }, NOT UnifiedMedia.
  // The ArtistCard component should accept this shape, or normalize in the server function.
  const result = await getMusicArtists(userId, { sort, limit: 200 });

  // Client-side search filter
  let artists = result.items;
  if (search) {
    const q = search.toLowerCase();
    artists = artists.filter((a: any) => (a.name ?? a.title ?? '').toLowerCase().includes(q));
  }

  return { artists, currentSort: sort, search };
};
```

- [ ] **Step 2: Create +page.svelte**

Artists page with:
- Search input at top
- Sort: Alphabetical (default), Most Played
- Responsive grid of circular ArtistCard components
- Empty state

Match the mockup's artists grid.

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/music/artists/+page.svelte" "src/routes/music/artists/+page.server.ts"
git commit -m "feat(music): artists grid page with search"
```

---

### Task 9: Songs Page

**Files:**
- Create: `src/routes/music/songs/+page.svelte`
- Create: `src/routes/music/songs/+page.server.ts`
- Modify: `src/lib/server/music.ts`

- [ ] **Step 1: Add getMusicSongs to server/music.ts**

New function that queries Jellyfin for all audio items:

```typescript
export async function getMusicSongs(userId: string, opts: {
  sort?: string; limit?: number; offset?: number; search?: string;
} = {}) {
  const configs = getJellyfinMusicConfigs();
  const results: UnifiedMedia[] = [];
  for (const config of configs) {
    const cred = resolveJellyfinCred(config, userId);
    if (!cred) continue;
    const items = await getItems(config, cred, {
      IncludeItemTypes: 'Audio',
      Recursive: 'true',
      SortBy: opts.sort ?? 'SortName',
      SortOrder: opts.sort === 'DateCreated' ? 'Descending' : 'Ascending',
      Limit: String(opts.limit ?? 100),
      StartIndex: String(opts.offset ?? 0),
      SearchTerm: opts.search
    });
    results.push(...items);
  }
  return results;
}
```

Note: `getItems` may need to be adapted from the existing Jellyfin adapter pattern. Check how `getMusicAlbums` fetches items and follow the same approach.

- [ ] **Step 2: Create +page.server.ts**

Load songs with pagination:
```typescript
const songs = await getMusicSongs(userId, { sort, limit: 100, offset, search });
```

- [ ] **Step 3: Create +page.svelte**

Songs page with:
- Filter bar: "All" and "Liked ♥" toggle + search input
- Full track table using existing `TrackRow.svelte` component
- Columns: #, Title + Artist (stacked), Album, Duration
- Currently playing row highlighted
- Click row to play (set queue to song list starting at that track)
- Virtual scrolling for large libraries (IntersectionObserver, same pattern as books)

Match the mockup's songs table.

Use the `svelte-file-editor` agent.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/music.ts "src/routes/music/songs/+page.svelte" "src/routes/music/songs/+page.server.ts"
git commit -m "feat(music): songs table page with search and liked filter"
```

---

## Phase 3: Detail & Discovery Pages

### Task 10: Album Detail Page

**Files:**
- Create: `src/routes/music/albums/[id]/+page.svelte`
- Create: `src/routes/music/albums/[id]/+page.server.ts`

- [ ] **Step 1: Create +page.server.ts**

```typescript
import type { PageServerLoad } from './$types';
import { getMusicAlbumDetail, getMusicAlbums } from '$lib/server/music';

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const userId = locals.user?.id;
  const serviceId = url.searchParams.get('service') ?? '';
  if (!userId) throw error(401);

  const album = await getMusicAlbumDetail(userId, params.id, serviceId);
  if (!album) throw error(404, 'Album not found');

  // More by this artist
  const artistId = album.album?.metadata?.artistId;
  let moreByArtist: UnifiedMedia[] = [];
  if (artistId) {
    const allByArtist = await getMusicAlbums(userId, { artistId });
    moreByArtist = allByArtist.filter(a => a.sourceId !== params.id).slice(0, 6);
  }

  return { album: album.album, tracks: album.tracks, moreByArtist, serviceId };
};
```

**Important:** `getMusicAlbumDetail` in `server/music.ts` currently returns `{ tracks }` only — it does NOT fetch the album item itself. You must also fetch the album metadata by calling the Jellyfin adapter's `getItem(config, albumId, userCred)` or by querying `/Items/{albumId}`. Return both: `{ album: UnifiedMedia, tracks: UnifiedMedia[] }`. Modify `getMusicAlbumDetail` in `server/music.ts` to include this.

- [ ] **Step 2: Create +page.svelte**

Album detail page with:
- Hero: large album art (220px), "Album" label, title (Playfair Display 28px), artist (clickable → `/music/artists/[id]`), year + track count + duration
- Action row: Play button (48px gold circle), Shuffle, Heart/like, overflow menu
- Tracklist: table with #, Title, Artist, Duration. Playing track shows equalizer bars. Click plays that track (sets queue to album).
- "More by [Artist]" row below

Wire play actions to musicStore: `setQueue(tracks, startIndex)` then `loadAndPlay`.

Match the mockup's album detail page.

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/music/albums/[id]/+page.svelte" "src/routes/music/albums/[id]/+page.server.ts"
git commit -m "feat(music): album detail page with tracklist and play actions"
```

---

### Task 11: Artist Detail Page

**Files:**
- Create: `src/routes/music/artists/[id]/+page.svelte`
- Create: `src/routes/music/artists/[id]/+page.server.ts`
- Modify: `src/lib/server/music.ts`

- [ ] **Step 1: Add getArtistTopSongs to server/music.ts**

```typescript
export async function getArtistTopSongs(userId: string, artistId: string, serviceId: string, limit = 5) {
  const configs = getJellyfinMusicConfigs();
  const config = configs.find(c => c.id === serviceId) ?? configs[0];
  if (!config) return [];
  const cred = resolveJellyfinCred(config, userId);
  if (!cred) return [];
  // Query Jellyfin for audio items by this artist, sorted by play count
  return await getItems(config, cred, {
    ArtistIds: artistId,
    IncludeItemTypes: 'Audio',
    Recursive: 'true',
    SortBy: 'PlayCount',
    SortOrder: 'Descending',
    Limit: String(limit)
  });
}
```

Adapt `getItems` to whatever pattern `getMusicAlbums` uses for querying Jellyfin.

- [ ] **Step 2: Create +page.server.ts**

Load artist info, top songs, discography, similar artists:
```typescript
const [artistDetail, topSongs] = await Promise.all([
  getMusicArtistDetail(userId, params.id, serviceId),
  getArtistTopSongs(userId, params.id, serviceId, 5)
]);
```

- [ ] **Step 3: Create +page.svelte**

Artist detail page with:
- Hero banner: background image (darkened + gradient), artist name (Playfair 36px), stats, Play + Shuffle + Following buttons
- Top Songs section: 5 track rows (title, album, duration)
- Discography: horizontal scroll of AlbumCards sorted by year
- Similar Artists: horizontal scroll of ArtistCards (from Jellyfin suggestions or instant mix)

Match the mockup's artist detail page.

Use the `svelte-file-editor` agent.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/music.ts "src/routes/music/artists/[id]/+page.svelte" "src/routes/music/artists/[id]/+page.server.ts"
git commit -m "feat(music): artist detail page with top songs and discography"
```

---

### Task 12: Playlists Page

**Files:**
- Create: `src/routes/music/playlists/+page.svelte`
- Create: `src/routes/music/playlists/+page.server.ts`

- [ ] **Step 1: Create +page.server.ts**

```typescript
import { getUserPlaylists, getLikedTracks } from '$lib/server/music';

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user?.id;
  if (!userId) return { playlists: [], likedCount: 0 };

  const [playlists, liked] = await Promise.all([
    getUserPlaylists(userId),
    getLikedTracks(userId)
  ]);

  return { playlists, likedCount: liked.length };
};
```

- [ ] **Step 2: Create +page.svelte**

Playlists page with:
- Liked Songs card (gradient background, heart icon, track count) — uses existing `LikedSongsCard.svelte`
- User playlist cards (2×2 mosaic) — uses existing `PlaylistCard.svelte`
- Create Playlist card (dashed border, "+" icon, click opens name input dialog)
- Grid layout matching the mockup

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/music/playlists/+page.svelte" "src/routes/music/playlists/+page.server.ts"
git commit -m "feat(music): playlists page with liked songs and create new"
```

---

### Task 13: Wanted Page

**Files:**
- Create: `src/routes/music/wanted/+page.svelte`
- Create: `src/routes/music/wanted/+page.server.ts`

- [ ] **Step 1: Create +page.server.ts**

```typescript
import { getMusicWanted, getMusicQueue } from '$lib/server/music';

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user?.id;
  if (!userId) return { wanted: [], queue: [] };

  const [wanted, queue] = await Promise.all([
    getMusicWanted(userId),
    getMusicQueue()
  ]);

  return { wanted, queue };
};
```

- [ ] **Step 2: Create +page.svelte**

Wanted page with two sections:
1. Wanted Albums: list of Lidarr missing albums (art, title, artist, "Missing" badge in warm red)
2. Download Queue: list of in-progress downloads (art, title, artist, "Downloading" badge in teal, progress bar)

Match the mockup's wanted page.

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/music/wanted/+page.svelte" "src/routes/music/wanted/+page.server.ts"
git commit -m "feat(music): wanted page with Lidarr missing albums and download queue"
```

---

### Task 14: Music Search Page

**Files:**
- Create: `src/routes/music/search/+page.svelte`
- Create: `src/routes/music/search/+page.server.ts`

- [ ] **Step 1: Create +page.server.ts**

Server-side search when `?q=` param is present:

```typescript
export const load: PageServerLoad = async ({ url, locals }) => {
  const userId = locals.user?.id;
  const query = url.searchParams.get('q') ?? '';
  if (!userId || !query) return { query, songs: [], albums: [], artists: [], playlists: [] };

  // Search Jellyfin for music items
  const [songs, albums, artists, playlists] = await Promise.all([
    getMusicSongs(userId, { search: query, limit: 10 }),
    getMusicAlbums(userId, { search: query, limit: 10 }),
    getMusicArtists(userId, { search: query, limit: 10 }),
    getUserPlaylists(userId) // filter client-side by query
  ]);

  const matchingPlaylists = playlists.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  return { query, songs, albums, artists, playlists: matchingPlaylists };
};
```

- [ ] **Step 2: Create +page.svelte**

Search page with:
- Large search input at top (auto-focus, updates URL on debounced input)
- Categorized results: Top Result (large card), Songs (4 rows), Albums (4 cards), Artists (4 circles), Playlists
- Each section has "See all" link (could just filter the search)
- Empty state: "Search your music library"

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/music/search/+page.svelte" "src/routes/music/search/+page.server.ts"
git commit -m "feat(music): dedicated music search page with categorized results"
```

---

## Phase 4: Polish & Integration

### Task 15: Now Playing Overlay

**Files:**
- Create: `src/lib/components/music/NowPlayingOverlay.svelte`
- Create: `src/lib/components/music/QueuePanel.svelte`
- Modify: `src/lib/components/music/MusicPill.svelte`

- [ ] **Step 1: Create NowPlayingOverlay.svelte**

Full-screen overlay component.

```typescript
interface Props {
  visible: boolean;
  onClose: () => void;
}
```

Features:
- Full-screen fixed overlay with color-extracted background gradient (canvas-based: draw album art to offscreen canvas, sample 5 points for dominant colors, build CSS gradient)
- Large album art (320px, rounded-16px, heavy shadow + accent glow)
- Track title (Playfair Display 22px) + artist (clickable) + album
- Seek bar (360px, gold fill, draggable scrubber)
- Time display (mono font)
- Transport: shuffle, prev, play/pause (56px gold), next, repeat
- Secondary: Like, Queue (opens QueuePanel), Lyrics (placeholder), Devices (placeholder)
- Close button (×) top-right
- **Morph animation**: opens from pill position (scale + translate), 500ms cubic-bezier(0.16, 1, 0.3, 1)

Wire all controls to musicStore functions.

Use the `svelte-file-editor` agent.

- [ ] **Step 2: Create QueuePanel.svelte**

Slide-in panel from right side of Now Playing overlay.

```typescript
interface Props {
  visible: boolean;
  onClose: () => void;
}
```

Features:
- Currently playing track (highlighted, accent border)
- "Next in Queue" section — list of upcoming tracks
- Each track: album art thumbnail, title, artist, drag handle, remove button
- Drag handles for reorder (pointer events based, like ReaderProgressBar scrubber)
- Wire to musicStore: `moveInQueue()`, `removeFromQueue()`

Use the `svelte-file-editor` agent.

- [ ] **Step 3: Wire MusicPill to open Now Playing**

In MusicPill.svelte, add a click handler on the pill that opens the NowPlayingOverlay. Import the overlay and add state:

```typescript
let showNowPlaying = $state(false);
```

The pill click (not on control buttons) sets `showNowPlaying = true`. The overlay's `onClose` sets it back to `false`.

Add the overlay to MusicPill's template:

```svelte
<NowPlayingOverlay visible={showNowPlaying} onClose={() => showNowPlaying = false} />
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/music/NowPlayingOverlay.svelte src/lib/components/music/QueuePanel.svelte src/lib/components/music/MusicPill.svelte
git commit -m "feat(music): Now Playing overlay with morph animation and queue panel"
```

---

### Task 16: Command Palette Music Integration

**Files:**
- Modify: `src/lib/components/CommandPalette.svelte`

- [ ] **Step 1: Add music play action to search results**

Read CommandPalette.svelte first. It already supports a 'music' scope (line 11) and groups results by type.

Add a play button/action for music search results. When a song result is clicked:
- Instead of navigating to the media page, call `playTrack()` from musicStore
- Import: `import { playTrack, setQueue } from '$lib/stores/musicStore.svelte';`
- For songs: clicking plays the song immediately
- For albums: clicking navigates to `/music/albums/[id]`
- For artists: clicking navigates to `/music/artists/[id]`

The key change is in the result click handler — add a condition for music type that calls musicStore instead of `goto()`.

Note: The Track type now requires `sourceId` and `serviceId`. The search results from the existing library search return `UnifiedMedia` objects. You'll need to convert: `{ id: item.id, sourceId: item.sourceId, serviceId: item.serviceId, title: item.title, artist: item.metadata?.artist, album: item.metadata?.album, albumId: item.metadata?.albumId, duration: item.duration ?? 0, image: item.poster ?? '' }`.

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/CommandPalette.svelte
git commit -m "feat(music): add music play action to Command Palette search"
```

---

### Task 17: Final Polish and Integration Testing

- [ ] **Step 1: Verify dev server starts**

Run: `pnpm dev`
Check for build errors. Fix any import issues.

- [ ] **Step 2: Test music playback flow**

1. Navigate to `/music` — verify home page loads with albums/artists
2. Go to `/music/albums` — verify grid, filters, search
3. Click an album → album detail — verify tracklist
4. Click a track → verify MusicPill appears, real audio plays
5. Hover pill → verify transport controls
6. Click pill → verify Now Playing overlay with morph animation
7. Test queue panel — add tracks, reorder, remove
8. Navigate to other pages → verify music keeps playing
9. Open a video → verify music pauses, pill collapses
10. Close video → verify music resumes

- [ ] **Step 3: Test all music routes**

- `/music/artists` — grid loads
- `/music/artists/[id]` — hero, top songs, discography
- `/music/songs` — table loads, liked filter works
- `/music/playlists` — playlists show, create works
- `/music/wanted` — Lidarr data shows (if configured)
- `/music/search` — search returns categorized results

- [ ] **Step 4: Smoke test non-music pages**

Movies, shows, books, games, settings all still work.

- [ ] **Step 5: Run typecheck**

```bash
pnpm check
```
Fix any type errors from the music changes. Ignore vendor/foliate-js errors.

- [ ] **Step 6: Final commit (specific files only)**

```bash
git add src/lib/ src/routes/music/ src/routes/+layout.svelte
git commit -m "feat(music): final polish and integration fixes"
```
