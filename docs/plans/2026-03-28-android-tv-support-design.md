# Nexus TV Mode — Design Spec

**Issue:** #25 — Android TV Support
**Date:** 2026-03-28
**Status:** Approved

## Overview

Add a dedicated TV experience to Nexus via a `/tv` SvelteKit route with spatial navigation, 10-foot UI, and remote control support. The web UI works standalone in any browser and serves as the rendering layer inside thin native shell apps (Kotlin for Android/Fire TV, Swift for iOS/macOS) that provide launcher integration, downloads, and native video playback.

## Architecture

```
┌──────────────────────────────────────────────┐
│           Native Shell (Phase 2+)            │
│   Kotlin (Android TV / Phone / Fire TV)      │
│   Swift  (iOS / macOS)                       │
│                                              │
│   Handles: auth, downloads, native player,   │
│            launcher icon, push notifications  │
│                                              │
│   ┌──────────────────────────────────────┐   │
│   │   WebView → SvelteKit /tv route      │   │
│   │   + Service Worker (offline UI)      │   │
│   └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘

Phase 1: /tv route works standalone in any browser
Phase 2: Kotlin shell wraps it for Android TV/Phone/Fire TV
Phase 3: Native player handoff + download manager
Phase 4: Swift shell for iOS/macOS
```

## Why Not Flutter / PWA

- **PWAs cannot be installed on Android TV** — no TWA support, no launcher integration, no install prompt.
- **Flutter** adds framework overhead (Dart runtime, engine bugs like broken text input on TV) for a shell that's only ~200-300 lines of native code per platform.
- **Native WebView shells** are simpler: direct platform API access, smaller app size, no framework bugs.

## Phase 1: /tv SvelteKit Route

### Route Structure

```
src/routes/tv/
  +layout.svelte          ← TV shell (sidebar + spatial nav init)
  +layout.server.ts       ← Auth check, user data, service list
  +page.svelte            ← Home/Discover (hero + media rows)
  library/
    +page.svelte          ← All libraries grid
    [type]/+page.svelte   ← Movies, Shows, Music filtered view
  search/
    +page.svelte          ← Letter grid + voice search
  play/
    [serviceId]/[itemId]/
      +page.svelte        ← Fullscreen player (or native handoff)
```

- Completely separate layout group from desktop — no shared components.
- Reuses existing adapters, server logic, API layer, and auth (cookie-based sessions).
- TV route is excluded from desktop navigation; desktop routes excluded from TV layout.

### Screens in Scope

- **Home/Discover** — hero carousel with trailer autoplay + media rows
- **Libraries** — grid view of all libraries, filtered by type
- **Search** — on-screen letter grid + Web Speech API voice input
- **Player** — fullscreen with remote-friendly controls

### Out of Scope (for TV)

Admin, Settings, Books, Requests — lean-forward tasks better suited to desktop/phone.

### TV Components

```
src/lib/components/tv/
  TVLayout.svelte         ← Shell: sidebar + content area
  TVSidebar.svelte        ← Icon rail, expands on focus
  TVHero.svelte           ← Cinematic hero with poster/backdrop + trailer autoplay
  TVMediaRow.svelte       ← Horizontal scrolling card row
  TVMediaCard.svelte      ← Poster card with scale+glow focus
  TVPlayer.svelte         ← Fullscreen player (or native handoff)
  TVSearch.svelte         ← Letter grid + voice
  TVLetterGrid.svelte     ← On-screen keyboard for search
  TVDialog.svelte         ← Modal dialogs (confirm, context menu)
  TVLoading.svelte        ← Full-screen loading/splash
```

**Design decisions:**

- **TVMediaRow** handles horizontal scrolling via focus — arrow keys move through cards, row auto-scrolls to keep focused card visible. No scroll buttons, no touch gestures.
- **TVMediaCard** — poster, title, year. No 3D tilt, no hover states, no mouse events. Scale (1.08x) + accent glow ring (`0 0 0 2px #d4a253, 0 0 20px rgba(212,162,83,0.3)`) on focus.
- **TVHero** — auto-rotates featured items on timer. D-pad left/right cycles manually. Down moves to first media row. After 5 seconds on a hero card, the backdrop crossfades into a muted trailer video (matching desktop TrailerPlayer behavior).
- **TVSidebar** — collapsed icon rail (~56px). Expands to show labels (~190px) with a slide animation when focus enters the sidebar. Collapses when focus leaves. Active item highlighted. Uses Nexus accent color for focus ring.
- **TVPlayer** detects native shell (`window.nexusShell` bridge object injected by Kotlin/Swift shells) and hands off to native player. Otherwise uses simplified web player.

### Spatial Navigation

**Library:** `js-spatial-navigation` (vanilla JS, DOM-based)

**Svelte integration:**

```
src/lib/tv/
  spatial.ts              ← init, config, Svelte actions (use:focusable, use:focusSection)
  remote.ts               ← remote control key mapping
  focus.ts                ← focus management store (current section, last focused per section)
```

**Actions:**
- `use:focusable` — registers element with spatial nav, manages lifecycle
- `use:focusSection` — defines a navigation zone (sidebar, hero, each media row)

**Focus flow:**

```
┌──────────┬──────────────────────────────┐
│ Sidebar  │  Hero (auto-focused on load) │
│ (section)│  [Watch] [Info]              │
│          ├──────────────────────────────┤
│  ⌂ Home  │  Continue Watching →         │
│  🎬 Movies│  [card] [card] [CARD] [card] │
│  📺 Shows ├──────────────────────────────┤
│  ♫ Music │  Trending →                  │
│  🔍 Search│  [card] [card] [card] [card] │
└──────────┴──────────────────────────────┘
```

**Key mapping:**
- Arrow keys: move focus within/between sections
- OK/Enter: select focused item
- Back/Backspace: go up one level, or open sidebar
- Left at first card in a row: enter sidebar
- Right from sidebar: return to content (remember last focused element)
- Media keys (play/pause/ff/rw): mapped in player

### Player

**Browser mode (Phase 1):**
- Fullscreen layout, controls auto-hide after 4s, reappear on any D-pad press
- Remote: OK = play/pause, Left/Right = seek 10s/30s, Up = quality/subtitle menu, Down = progress bar
- HLS/DASH via existing hls.js/dashjs
- SponsorBlock auto-skip works as-is
- No PiP, theater mode, or speed control (desktop-only features)
- Subtitle/audio selection via simple overlay menu (D-pad up to open, left/right to pick, OK to confirm)

**Native handoff (Phase 3):**
- Detect `window.nexusShell` (bridge object injected by native shells)
- Call `window.nexusShell.playMedia({ serviceId, itemId, streamUrl, position })`
- Native player handles hardware decoding, DRM
- On stop/pause, native calls back with current position for Jellyfin progress sync

### Search

**Letter grid:**
- Standard TV keyboard layout (QWERTY or alphabetical grid)
- Results update live as letters are entered
- D-pad navigation through the grid, OK to select letter, dedicated button to backspace

**Voice (when available):**
- Web Speech API — check `window.SpeechRecognition`
- Mic icon in search UI, activates on OK press
- Falls back to letter grid if not supported

**Phone companion (future):**
- Paired device can type search queries
- Same pairing mechanism as auth
- Out of scope for Phase 1

### Styling

All new CSS — the existing `.tv-mode` classes in `app.css` will be removed and replaced.

**Design language:**
- Background: `#0d0b0a` (void)
- Card backgrounds: gradient `#2a2420` → `#1a1614`
- Focus ring: `0 0 0 2px #d4a253, 0 0 20px rgba(212,162,83,0.3)` with scale(1.08)
- Text: `#f0ebe3` (cream) primary, `#a09890` (muted) secondary, `#6b6560` (faint) tertiary
- Accent: `#d4a253` (gold)
- Typography: Playfair Display for titles, DM Sans for body
- All TV styles scoped to `/tv` route layout — no `!important` overrides, no brittle Tailwind selectors

### PWA & Service Worker

**Two separate manifests:**

`static/manifest.json` (desktop/mobile):
- `name: "Nexus"`
- `display: standalone`
- Standard icons (192px, 512px)
- `start_url: "/"`

`static/tv/manifest.json` (TV):
- `name: "Nexus TV"`
- `display: fullscreen`
- `orientation: landscape`
- Landscape-oriented icons
- `start_url: "/tv"`

**Service worker** — `src/service-worker.ts`:
- Precache app shell (built JS/CSS/fonts) for offline UI
- Runtime cache API responses: network-first with cache fallback for `/api/` routes
- Cache-first for posters/backdrops (rarely change)
- Enables offline browsing of previously visited content
- In native shells, service worker handles UI offline; native layer handles media files

## Phase 2: Kotlin Shell (Android TV / Phone / Fire TV)

Thin native Android app (~200-300 lines):
- **WebView** loads `https://<nexus-server>/tv`
- **Auth screens** — native UI for QR code (primary), PIN code (fallback), on-screen password keyboard (last resort)
- **Token storage** — Android Keystore, injected into WebView as cookie
- **Launcher integration** — standard Android TV Leanback launcher icon
- **Bridge** — JavaScript interface (`window.nexusShell`) for communication between WebView and native layer
- Single APK targets Android TV + phone + Fire TV

### Auth Flow

```
App launch
  → Check Keystore for stored token
  → If none: show native auth screen
    → QR: display code, poll server for confirmation
    → PIN: display code, user enters at nexus-server/pair
    → Password: native on-screen keyboard
    → POST /api/auth/login → store token
  → Inject token into WebView
  → Load /tv
```

### Bridge Interface

```kotlin
@JavascriptInterface
fun playMedia(json: String)    // Native player handoff
fun startDownload(json: String) // Queue media download
fun getDownloads(): String      // Return downloaded items as JSON
fun getShellInfo(): String      // { platform, version, capabilities }
```

## Phase 3: Downloads & Native Player

### Download Manager (Kotlin)

- Triggered via bridge: `window.nexusShell.startDownload({ serviceId, itemId, title, type })`
- Fetches from existing SvelteKit streaming endpoint: `GET /api/stream/{serviceId}/{itemId}/stream`
- Stored to local filesystem with metadata in local SQLite DB
- Background download support via Android DownloadManager
- Progress reported back to WebView via `evaluateJavascript()`

### Native Player

- Intercepts play URLs or bridge calls
- ExoPlayer (Android) for hardware-accelerated decoding
- Receives stream URL + position from WebView
- Reports playback position back for Jellyfin progress sync
- Supports offline playback from downloaded files

### Offline

- **Service worker** caches UI shell + API responses → browse library offline
- **Native download DB** tracks downloaded media → play offline
- WebView queries native shell for download state via bridge
- Offline indicator shown in TV UI when no network detected

## Phase 4: Swift Shell (iOS / macOS)

Same pattern as Kotlin shell but in Swift:
- WKWebView loads `/tv` route
- Native auth (QR/PIN/password) with Keychain token storage
- AVPlayer for native video playback
- URLSession for background downloads
- Shared codebase for iOS and macOS (Catalyst or SwiftUI multiplatform)

## Testing Strategy

- **Phase 1:** Playwright E2E tests for TV route, keyboard navigation tests, manual testing in Chrome with DevTools device emulation
- **Phase 2+:** Android emulator (Android TV x86 image), physical device testing
- **Spatial nav:** Automated tests for focus flow — verify arrow keys move focus correctly between sections
- **Player:** Test HLS/DASH playback, subtitle switching, remote key handling
