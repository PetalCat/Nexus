# Hero Trailers — Design Spec

**Date:** 2026-03-27
**Goal:** Add auto-playing muted trailers as hero backdrops across the app, with a unified hero component that replaces the current per-page hero implementations.

---

## Trailer Source Chain

1. **Jellyfin `RemoteTrailers`** — add `RemoteTrailers` to the Jellyfin adapter's FIELDS constant. Items return an array of `{ Url, Name }` (typically YouTube links from TMDB metadata). Store the first trailer URL in `UnifiedMedia.metadata.trailerUrl`.
2. **Invidious proxy fallback** — if no Jellyfin trailer exists and an Invidious service is configured, search `"[title] [year] official trailer"` via Invidious API, take the top result. Resolve to a stream URL through the existing Rust stream proxy.
3. **Cache** — resolved trailer stream URLs are cached (keyed by `mediaId:serviceId`, 24h TTL). Resolution is async and non-blocking — hero renders with static backdrop immediately, trailer replaces it once resolved.

---

## Unified Hero Component

Replace the current per-page hero implementations (HeroCarousel.svelte inline markup, media detail page inline hero, browse page inline heroes) with a single `HeroSection.svelte` component that operates in three modes.

### HeroSection.svelte

Responsible for:
- **Backdrop layer** — static image (default) or trailer video (when available and user preference allows)
- **TrailerPlayer** — `<video>` element positioned behind content, absolute-fill, object-fit cover
- **Gradient overlays** — bottom fade + left fade, consistent across all modes
- **Mute/unmute toggle** — top-right, remembers state in localStorage
- **Trailer progress bar** — thin accent bar at bottom of hero
- **"Trailer Playing" / "Preview" badge** — top-right next to mute button
- **Content slot** — `{@render children()}` for page-specific content (title, metadata, CTAs, poster, etc.)

Props:
- `backdrop: string` — static backdrop image URL
- `trailerUrl?: string` — resolved trailer stream URL (if available)
- `mode: 'carousel' | 'detail' | 'browse'` — controls height and behavior
- `autoplay?: boolean` — default true, overridden by user preference
- `delay?: number` — ms before trailer starts (default 5000)

### TrailerPlayer.svelte

Internal component used by HeroSection. Handles:
- Loading trailer video (HLS via hls.js or direct MP4)
- Autoplay muted after configurable delay
- Fade transition from backdrop image to video
- Mute/unmute state (synced with HeroSection toggle via bindable)
- Pausing when off-screen (IntersectionObserver)
- Cleanup on destroy
- Respects `prefers-reduced-motion` — disables autoplay
- Falls back silently to static backdrop on load error

---

## Hero Modes

### Mode 1: Carousel (Homepage)

**Height:** `clamp(300px, 50vh, 520px)`

Used on the homepage (`/`). Multiple hero items cycle with auto-advance. The active slide's trailer plays as backdrop.

Content slot contains: reason badge, title, year/runtime/rating metadata, genres, overview (2-line clamp), Play + More Info CTAs, dot navigation, arrow buttons.

When auto-advance moves to next slide, current trailer stops, new trailer starts after delay. Carousel pauses auto-advance while trailer is playing and unpaused by user.

### Mode 2: Detail (Media Page)

**Height:** `clamp(320px, 55vh, 560px)`

Used on `/media/[type]/[id]`. Single item, no carousel.

Content slot contains: poster, title, metadata (year, runtime, official rating, critic score, rating pills), star rating widget, overview (3-line clamp), Play + Watch Trailer + Watchlist CTAs.

"Watch Trailer" button behavior: if trailer is available, clicking it unmutes the already-playing backdrop video (or starts it if not autoplaying). If no trailer, button is hidden.

### Mode 3: Browse (Movies, Shows, Games pages)

**Height:** `clamp(200px, 30vh, 300px)`

Used on `/movies`, `/shows`, `/games`, etc. Features the top item from the page's content.

Content slot contains: small poster, title, compact metadata, Play + Details CTAs. Page title as large faded watermark on the right.

**Card hover trigger:** when a user hovers a media card in the grid below for 2-3s, the browse hero swaps to show that card's backdrop/trailer. The page passes a reactive `activeItem` binding that the hero watches. On hover-end, reverts to the default featured item after a short delay.

---

## Data Flow

### Homepage

`+page.server.ts` → `homepage-cache.ts` builds hero items → each `HeroItem` gains a `trailerUrl?: string` field.

Trailer resolution happens in `homepage-cache.ts` during hero item construction:
1. For each hero item, check `item.metadata.trailerUrl` (from Jellyfin RemoteTrailers)
2. If it's a YouTube URL + Invidious is configured, resolve to proxy stream URL
3. If no Jellyfin trailer + Invidious configured, search for one
4. Cache the resolved URL

### Media Detail

`+page.server.ts` already fetches the full item. Add trailer URL to the returned data:
1. Check `item.metadata.trailerUrl` from Jellyfin
2. Resolve via Invidious proxy if needed
3. Return as `trailerUrl` in page data

### Browse Pages

Each browse page (`/movies`, `/shows`, `/games`) selects a featured item for the hero. Trailer resolution follows the same pattern — check Jellyfin trailers, resolve via Invidious.

Card hover trailers: resolved lazily on hover. When a card is hovered for 2-3s, the page fetches the trailer URL for that item (via a new lightweight API endpoint or client-side resolution) and updates the hero's `trailerUrl` prop.

---

## Trailer Resolution API

`GET /api/media/[id]/trailer?service=xxx`

Returns `{ trailerUrl: string | null }`.

Server-side:
1. Get item from Jellyfin with `RemoteTrailers` field
2. If YouTube URL found, resolve through Invidious proxy to stream URL
3. If no trailer from Jellyfin, search Invidious for `"[title] [year] official trailer"`
4. Cache result (24h TTL)
5. Return the resolved stream URL (or null)

Used by card hover to lazily resolve trailers without requiring server-rendered data.

---

## User Preference

Add `autoplayTrailers` to `app_settings` table (per-user):
- `true` — trailers autoplay muted (default on desktop)
- `false` — trailers only play on explicit click (default on mobile)

Detection: on first visit, default based on screen width (`>= 768px` → true, else false). User can toggle in Settings → Playback.

Also respect `prefers-reduced-motion` media query — always disable autoplay regardless of user preference.

Mute state persisted in `localStorage` (not a server setting — instant toggle, no round-trip).

---

## Type Changes

### UnifiedMedia (types.ts)

Add to metadata: `trailerUrl?: string`

### HeroItem (homepage.ts)

Add: `trailerUrl?: string`

### Jellyfin Adapter

Add `RemoteTrailers` to FIELDS constant. In `normalize()`, extract first trailer URL: `metadata.trailerUrl = item.RemoteTrailers?.[0]?.Url`

---

## Mobile Behavior

- Default `autoplayTrailers` to `false` on mobile (screen width < 768px)
- "Watch Trailer" button still available — user can tap to play
- Hero height adapts via existing responsive clamp values
- Mute/unmute button visible when trailer is playing
- Card hover trigger disabled on touch devices (no hover event)

---

## Error Handling

- Trailer fails to load → silently fall back to static backdrop, no user-facing error
- Invidious unavailable → skip fallback, use static backdrop
- YouTube URL resolution fails → cache null result (shorter TTL: 1h) to avoid repeated failures
- Video decode error → stop trailer, show backdrop
