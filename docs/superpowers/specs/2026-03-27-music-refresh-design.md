# Music Refresh — Design Spec

**Date:** 2026-03-27
**Scope:** Global audio player, MusicPill wiring, music hub pages, album/artist detail, now playing overlay, search, media conflict handling

---

## 1. Architecture

### Global Audio Layer

The musicStore (`src/lib/stores/musicStore.svelte.ts`) owns a real `<audio>` element that persists across all page navigation. This replaces the current simulated timer-based playback.

- `<audio>` element created once in the root layout, never destroyed
- Stream URLs from Jellyfin: direct audio file URL via `/Items/{id}/Download` or `/Audio/{id}/universal` with user credentials
- musicStore manages: play, pause, seek, volume, queue, shuffle, repeat — all controlling the real `<audio>` element
- Progress tracked from `audio.currentTime / audio.duration` instead of simulated timer
- MediaSession API integration for OS-level controls (lock screen, media keys)

### Media Conflict Handling

- **Music + Books/Games:** Music continues playing. MusicPill stays visible with full controls.
- **Music + Video/Shows/Live TV:** When `Player.svelte` starts video playback, it calls `musicPlayer.pause()` and `musicPlayer.collapse()`. MusicPill collapses to minimal state or hides.
- **Video ends:** Show toast "Resume music?" or auto-resume after 2 seconds if music was playing before.
- musicStore exposes: `pause()`, `resume()`, `collapse()`, `isPlaying`, `wasPausedByMedia` (flag to know if we should auto-resume)

### MusicPill in Layout

- Import `MusicPill.svelte` in `src/routes/+layout.svelte`
- Renders when `musicPlayer.visible && musicPlayer.currentTrack` is truthy
- Fixed position bottom-right, z-index 50
- Persists across all navigation

---

## 2. Route Structure

```
/music              — Home (recently played, new in library, your artists)
/music/albums       — All albums grid (filterable by genre, searchable, sortable)
/music/albums/[id]  — Album detail (tracklist, play all, more by artist)
/music/artists      — All artists grid (searchable, sortable)
/music/artists/[id] — Artist detail (top songs, discography, similar artists)
/music/songs        — Full track table (sortable columns, liked filter)
/music/playlists    — User playlists + liked songs card + create new
/music/wanted       — Lidarr wanted albums + download queue
/music/search       — Dedicated search with categorized results
```

Each page has its own `+page.server.ts` for data fetching. All music pages share a sub-layout with the music nav bar.

---

## 3. Music Sub-Layout

A shared `src/routes/music/+layout.svelte` provides:

- **Nav bar** (sticky top): Home | Albums | Artists | Songs | Playlists | Wanted
- Pills/chips style, active tab has accent highlight
- Search icon in the nav bar that links to `/music/search`
- Below the nav, each page renders its content

---

## 4. Page Designs

### 4.1 Home (`/music`)

**Layout top to bottom:**

1. **Greeting header** — "Good Morning/Afternoon/Evening" based on time of day
2. **Recently played chips** — 2-column grid of compact chips (album art + title), Spotify-style quick-resume tiles. Click to play.
3. **Recently Played row** — horizontal scroll of album cards with hover play buttons
4. **New in Your Library row** — newest albums added (from `getRecentlyAdded`)
5. **Your Artists row** — horizontal scroll of circular artist avatars

**Data:** Recently played from `getRecentlyPlayed()` in server/music.ts — returns `{ mediaId, mediaTitle, serviceId, timestamp }`. Must be hydrated with album art and artist by fetching item details from Jellyfin (batch via `/Items?Ids=id1,id2,...`). New albums from Jellyfin `getRecentlyAdded`. Artists from Jellyfin `getArtists` sorted by play count.

### 4.2 Albums (`/music/albums`)

- **Filter bar:** Genre chips (All, Rock, Electronic, Hip-Hop, etc.) + search input (right-aligned)
- **Sort:** Recently Added (default), Title A-Z, Artist, Year
- **Grid:** Responsive album cards (cover art square, album name, artist name below). Hover shows gold play button overlay.
- Click album → `/music/albums/[id]`

**Data:** `getMusicAlbums(userId, { genre, sort, limit, offset })` with pagination.

### 4.3 Album Detail (`/music/albums/[id]`)

**Hero area:**
- Large album art (220px square, rounded-12px, heavy shadow)
- Right side: "Album" label, title (Playfair Display, 28px), artist name (clickable → artist page), year + track count + duration
- Action row: Play button (48px gold circle), Shuffle button, Heart/like, overflow menu (⋯)

**Tracklist:**
- Table with columns: # (track number), Title, Artist, Duration
- Currently playing track: equalizer bars replace track number, title in accent color
- Hover: track number becomes play icon
- Click row to play that track (sets queue to album starting at that track)

**Below tracklist:**
- "More by [Artist]" — horizontal scroll of other albums by same artist

### 4.4 Artists (`/music/artists`)

- **Search bar** at top
- **Grid:** Circular artist avatars with name below. Responsive columns.
- **Sort:** Alphabetical (default), Most Played
- Click artist → `/music/artists/[id]`

**Data:** `getMusicArtists(userId, { sort, limit, offset })`

### 4.5 Artist Detail (`/music/artists/[id]`)

**Hero banner:**
- Full-width background image (artist photo, darkened + gradient to void at bottom)
- Artist name (Playfair Display, 36px, text shadow)
- Stats: "X albums · Y tracks in your library"
- Action row: Play button, Shuffle All button, Following indicator

**Sections below hero:**
1. **Top Songs** — 5 tracks table (title, album, duration). No "see all" needed since all songs are in albums.
2. **Discography** — horizontal scroll of album cards, sorted by year descending
3. **Similar Artists** — horizontal scroll of circular artist cards (from Jellyfin suggestions or Lidarr)

**Data:** `getMusicArtistDetail(userId, artistId, serviceId)` returns artist info + albums. New server function `getArtistTopSongs(userId, artistId, serviceId, limit=5)` — queries Jellyfin `/Items` with `ArtistIds={artistId}`, `IncludeItemTypes: 'Audio'`, `SortBy: 'PlayCount'`, `SortOrder: 'Descending'`.

### 4.6 Songs (`/music/songs`)

- **Filter bar:** "All" and "Liked ♥" toggle chips + search input
- **Full track table:**
  - Columns: #, Title + Artist (stacked), Album, Duration
  - Currently playing row highlighted with equalizer bars + accent color
  - Sortable by clicking column headers (title, artist, album, duration, date added)
  - Click row to play (sets queue to filtered song list starting at that track)
- Virtual scrolling for large libraries (same pattern as books grid)

**Data:** New server function `getMusicSongs(userId, { sort, limit, offset, search, liked })` — queries Jellyfin with `IncludeItemTypes: 'Audio'`, `Recursive: 'true'`, paginated. Liked status joined from `music_liked_tracks` table. Must use server-side pagination (not fetch-all) for large libraries.

### 4.7 Playlists (`/music/playlists`)

- **Grid layout:**
  - **Liked Songs card** — gradient background (purple → gold → warm), heart icon, track count. Click to view liked songs as a playlist.
  - **User playlist cards** — 2×2 mosaic of album art from first 4 tracks, playlist name, track count. Single-album playlists show single cover.
  - **Create Playlist card** — dashed border, "+" icon. Click opens create dialog (name input).
- Click playlist → shows playlist detail (inline or separate view) with tracklist, drag-to-reorder, remove tracks

**Data:** `getUserPlaylists(userId)` + `getLikedTracks(userId)` count.

### 4.8 Wanted (`/music/wanted`)

Two sections:

1. **Wanted Albums** — list of Lidarr missing/monitored albums. Each row: album art, title, artist, status badge ("Missing" in warm red, "3 tracks missing" etc.)
2. **Download Queue** — list of in-progress downloads. Each row: album art, title, artist, status badge ("Downloading" in teal), progress bar.

**Data:** `getMusicWanted()` + `getMusicQueue()` from Lidarr adapter.

### 4.9 Search (`/music/search`)

- **Large search input** at top, instant results as you type
- **Categorized result sections** (like Spotify):
  - **Top Result** — large card for best match (album or artist)
  - **Songs** — 4 track rows with "See all" link
  - **Albums** — 4 album cards horizontal with "See all"
  - **Artists** — 4 artist circles horizontal with "See all"
  - **Playlists** — matching user playlists
- Empty state: show browse categories / genre chips

**Data:** Jellyfin search API (`/Items` with searchTerm), filtered by music types. Client-side playlist search.

---

## 5. MusicPill Component

The existing `MusicPill.svelte` is already well-built. Changes needed:

- **Wire real audio** — bind to musicStore's `<audio>` element state instead of simulated timer
- **Mount in layout** — import in `+layout.svelte`
- **Click opens Now Playing overlay** — morph animation (selected in brainstorming)
- **Collapse API** — `musicPlayer.collapse()` hides pill when video plays, `musicPlayer.expand()` restores it

No visual changes needed — the pill design is already polished.

---

## 6. Now Playing Overlay

Full-screen overlay (no route change) triggered by clicking the MusicPill.

**Layout (centered):**
- Large album art (320px, rounded-16px, heavy shadow + subtle accent glow)
- Background: color-extracted gradient from album art using canvas-based extraction (draw album art to offscreen canvas, sample corners/center for dominant colors, build CSS gradient). No external library needed — simple 5-point sampling is sufficient for dark washes.
- Track title (Playfair Display, 22px)
- Artist name (clickable → artist page) + album name
- Seek bar: 360px wide, gold fill, draggable scrubber with glow
- Time display: elapsed / remaining (mono font)
- Transport controls: shuffle, previous, play/pause (56px gold circle), next, repeat
- Secondary actions: Like, Queue, Lyrics (future enhancement — Jellyfin supports `/Audio/{id}/Lyrics` in 10.9+, defer to later), Devices

**Transition:**
- **Open:** Morph animation — pill scales up, overlay grows from pill position, album art scales from pill thumbnail to large. 500ms cubic-bezier.
- **Close:** Reverse morph — overlay shrinks back to pill position. 400ms ease-in.
- Click outside or close button (×) dismisses.

**Queue panel:**
- Accessible from "Queue" button in Now Playing
- Slide-in panel from right showing:
  - Currently playing (highlighted)
  - "Next in Queue" — user-added tracks
  - "Next from [Album/Playlist]" — auto-queue
  - Drag handles for reorder, swipe to remove

---

## 7. Command Palette Music Integration

The existing `CommandPalette.svelte` gets music search results:

- When typing, include music results alongside existing results
- Music result types: Songs (with play action), Albums (navigate to detail), Artists (navigate to detail)
- Music results grouped under a "Music" section header
- Playing a song from Command Palette starts playback immediately via musicStore

---

## 8. musicStore Rewrite — Real Audio

Replace simulated timer with real `<audio>` element:

### Track Type Update

Add `serviceId` and `sourceId` to the Track interface (required for stream URLs and liked tracks DB):
```typescript
export interface Track {
  id: string;           // composite ID (sourceId:serviceId) for consistency with UnifiedMedia
  sourceId: string;     // raw Jellyfin item ID (used in stream URLs)
  serviceId: string;    // which Jellyfin service this track is from
  title: string;
  artist: string;
  album: string;
  albumId: string;
  duration: number;
  image: string;
}
```

### New State
```typescript
let audioElement: HTMLAudioElement;  // created once, lives in layout
let _loading = false;               // buffering state
let _wasPausedByMedia = false;      // for auto-resume after video
let _collapsed = false;             // pill hidden during video playback (distinct from _visible)
```

### Audio Element Setup

**Must guard with `browser` check** — the store runs on import during SSR. Only create `Audio` in the browser.

```typescript
import { browser } from '$app/environment';

function initAudio() {
  if (!browser) return;
  audioElement = new Audio();
  audioElement.addEventListener('timeupdate', () => {
    _currentTime = audioElement.currentTime;
    _progress = audioElement.duration ? audioElement.currentTime / audioElement.duration : 0;
  });
  audioElement.addEventListener('ended', handleTrackEnd);
  audioElement.addEventListener('loadstart', () => _loading = true);
  audioElement.addEventListener('canplay', () => _loading = false);
}

// Call initAudio() at module level with browser guard, or from layout's onMount
if (browser) initAudio();
```

### Playing a Track

Use existing `playTrack` logic for single-track plays (preserves queue context). Use `setQueue` for "play this album/playlist starting at track N."

```typescript
function loadAndPlay(track: Track) {
  // Build stream URL using existing catch-all proxy (no new endpoint needed)
  const streamUrl = `/api/stream/${track.serviceId}/audio/${track.sourceId}/universal`;
  audioElement.src = streamUrl;
  audioElement.play();
  _playing = true;
  _visible = true;
  updateMediaSession(track);
  reportPlayStart(track); // write play_session for recently-played tracking
}
```

The stream URL uses the **existing path-based proxy** at `/api/stream/[serviceId]/[...path]/+server.ts` which already handles `/Audio/{id}/universal` with codec negotiation, direct play flags, and user credential injection.

### Play Session Tracking

Write `play_sessions` for music played through Nexus (not just Jellyfin clients):
```typescript
function reportPlayStart(track: Track) {
  fetch('/api/ingest/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mediaId: track.sourceId, serviceId: track.serviceId,
      mediaType: 'music', source: 'reader'
    })
  });
}
```
This ensures "recently played" on the home page shows tracks played through Nexus.

### Cleanup: Remove Simulated Playback

Remove the old simulated timer (`setInterval` with 250ms ticks), `allAlbumTracks`, `setTrackLibrary()`, `getTracksForAlbum()`, `getAllTracks()`, and `getRecommendedTracks()`. These are replaced by real audio events and server-side data.

### MediaSession API
```typescript
if ('mediaSession' in navigator) {
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
}
```

---

## 9. Media Conflict Handling

musicStore exposes two methods (not direct state access):

```typescript
// In musicStore
function pauseForMedia() {
  if (_playing) {
    _wasPausedByMedia = true;
    audioElement.pause();
    _playing = false;
    _collapsed = true;
  }
}

function resumeAfterMedia() {
  if (_wasPausedByMedia) {
    _wasPausedByMedia = false;
    _collapsed = false;
    audioElement.play();
    _playing = true;
  }
}

function collapse() { _collapsed = true; }
function expand() { _collapsed = false; }
```

### In Player.svelte (video player)

**Note:** Player.svelte currently has zero references to musicStore. This is entirely new integration code.

```typescript
import { pauseForMedia, resumeAfterMedia } from '$lib/stores/musicStore.svelte';

// On video play start
pauseForMedia();

// On video ended / player closed
resumeAfterMedia();
```

### MusicPill visibility

MusicPill renders when `musicPlayer.visible && musicPlayer.currentTrack && !musicPlayer.collapsed`. The `collapsed` state is distinct from `visible` — collapsed means music is loaded but pill is hidden during video playback.

---

## 10. Design Tokens

All music UI uses existing Nexus CSS variables:
- Backgrounds: `--color-void`, `--color-deep`, `--color-base`, `--color-raised`, `--color-surface`
- Text: `--color-cream`, `--color-muted`, `--color-faint`
- Accent: `--color-accent` (gold — play buttons, progress bars, active states)
- Steel: `--color-steel` (secondary accents — download progress)
- Warm: `--color-warm` (missing/error badges)
- Typography: `--font-display` (page titles, track titles in Now Playing), `--font-body` (UI), `--font-mono` (timestamps, durations)

Album art cards: square, rounded-10px, shadow on hover, gold play button overlay on hover.
Artist avatars: circular, subtle shadow, scale on hover.
Now Playing background: color-extracted from album art, dark gradient wash.
