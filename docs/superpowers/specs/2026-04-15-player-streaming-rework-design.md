# Player & Streaming Rework — Design

**Date:** 2026-04-15
**Status:** Design approved. Implementation plan next.
**Author session:** Parker + Claude, interactive design

## TL;DR

Nexus's video playback is three divergent pipelines (Jellyfin HLS, Invidious DASH/progressive, direct MP4) with duplicated quality-negotiation logic, a Node.js proxy that bottlenecks on segment delivery, a 2,299-line `Player.svelte` doing engine dispatch by prop sniffing, and a host of bugs that emerged this week (silent audio on AC3 sources, quality selector no-op on direct-stream, auto-mode cold-starting at the lowest level, subtitle 404 spam from PGS tracks, video subs burned-in by surprise). The rework replaces all of it with:

1. **One contract**: `negotiatePlayback(item, plan, caps) → PlaybackSession`. Adapters are the single source of truth for "how do I play this thing." Nexus never builds stream URLs or guesses Jellyfin params.
2. **One Rust byte pipe**: the existing `stream-proxy/` crate, grown to be adapter-agnostic and wired into the Docker build. Hyper end-to-end. No server-side decoding, ever.
3. **One Svelte player**: `NexusPlayer.svelte` with engine glue modules (hls / dash / progressive) dispatched by session type. Shared state, shared controls, zero URL-building.
4. **Transcode authority lives on the media server, never in Nexus.** Jellyfin decides direct-play vs remux vs direct-stream vs transcode based on the `DeviceProfile` we submit. Nexus's job is to ask correctly.
5. **Browser never talks to third parties.** Fonts self-hosted. No Google Fonts. CSP tightened. CI gate.

The user-visible result: blazing-fast segment delivery, a quality menu that actually changes the quality, a pill that tells you at a glance whether you're direct-playing or transcoding, honest auto mode that starts high and adapts down when the network demands it, and captions that don't surprise-burn into the pixels.

## Goals

- **Speed.** Zero-copy byte pipe via Rust. No Node event-loop stall on segment delivery. Connection pooling warm to Jellyfin/Invidious upstreams.
- **Clarity.** One place to ask "how do I play this?", one place for "how do bytes move?", one place for "how does it look on screen?" Every playback bug should have exactly one file to open.
- **Offload.** Nexus does the least work possible for a great experience. Transcoding is Jellyfin's job. YouTube CDN is Invidious's job. Nexus is a dumb pipe with good UI.
- **Privacy.** Every byte the user's browser loads comes from Nexus. Adapters may talk to third parties server-side; the browser never does.
- **Honesty.** The player shows what's actually happening — current quality, mode (direct / remux / audio-tx / transcode), whether captions are side-loaded or burned in. No hidden state.

## Non-goals

- Rewriting the control chrome, keyboard shortcuts, touch gestures, Chromecast/AirPlay stubs, watch-party hooks. These migrate textually from `Player.svelte` to `NexusPlayer.svelte`.
- HeroCarousel ambient background video — already uses pre-resolved URLs via Invidious, left alone.
- Book reader (foliate-js), audio-only Jellyfin music player, RomM game streams. Separate surfaces.
- Plex playback support. The contract accommodates it; implementation is future work.
- Pre-flight speedtest on player open. Adds launch latency.
- Predictive per-network profiles ("slow at home, fast at office"). Future.
- Chromecast / AirPlay. Current stubs stay as-is.

## Architecture

Three layers, each with one job.

```
┌────────────────────────── CLIENT ──────────────────────────┐
│  NexusPlayer.svelte                                         │
│   ├─ engines/hls-engine.ts       (hls.js glue)             │
│   ├─ engines/dash-engine.ts      (dash.js glue)            │
│   ├─ engines/progressive-engine.ts (native <video>)        │
│   ├─ PlayerState.svelte.ts       (rune store)              │
│   ├─ networkMonitor.ts           (stall + bandwidth)       │
│   └─ QualityMenu / AudioMenu / SubtitleMenu                │
└────────────────────────────────────────────────────────────┘
                           │
         POST /api/play/negotiate  (adapter-owned)
                           ▼
┌─────────────────── NODE (SvelteKit server) ───────────────┐
│  Adapter.negotiatePlayback(item, plan, caps)              │
│    ├─ Jellyfin: POST /Items/{id}/PlaybackInfo + DeviceProfile │
│    ├─ Invidious: /api/v1/videos + itag selection          │
│    └─ returns PlaybackSession { engine, url, mode, ... }  │
│                                                             │
│  POST /api/stream/session  →  spawns session in Rust proxy │
└────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────── RUST (nexus-stream-proxy) ────────────────┐
│  hyper 1.x end-to-end                                      │
│    ├─ POST /session   (store upstream URL + auth headers)  │
│    ├─ GET /stream/{id} (hyper → reqwest bytes_stream)      │
│    ├─ HLS master rewrite via m3u8-rs crate                 │
│    ├─ Range header passthrough                             │
│    ├─ CDN resolve (Invidious) — existing code module       │
│    └─ /stats endpoint                                      │
└────────────────────────────────────────────────────────────┘
```

Principle: **each layer does one job and trusts the others.** The Rust proxy doesn't know what Jellyfin is. The adapter doesn't know what hls.js is. The Player doesn't know what Jellyfin's query params look like. No knowledge leaks across layer boundaries, which is where the current codebase's bugs come from.

## The contract

```ts
// src/lib/adapters/contract.ts

interface NexusAdapter {
  // ... existing fields ...
  negotiatePlayback?(
    item: MediaItem,
    plan: PlaybackPlan,
    caps: BrowserCaps
  ): Promise<PlaybackSession>;
}

interface PlaybackPlan {
  targetHeight?: number;     // user picked 720p → 720. null = server decides
  maxBitrate?: number;       // optional bitrate cap. null = no cap
  audioTrackHint?: number;   // remember selection across sessions
  subtitleTrackHint?: number;
  burnSubIndex?: number;     // explicit user opt-in to burn-in; forces transcode
}

interface BrowserCaps {
  videoCodecs: string[];     // ['avc1.640028', 'hev1.1.6.L93.B0', ...]
  audioCodecs: string[];     // ['mp4a.40.2', 'opus', ...]
  containers: string[];      // ['mp4', 'ts', 'webm']
  maxHeight?: number;        // screen height * DPR
}

type PlaybackMode = 'direct-play' | 'remux' | 'direct-stream' | 'transcode';
type PlaybackEngine = 'hls' | 'dash' | 'progressive';

interface PlaybackSession {
  engine: PlaybackEngine;
  url: string;                      // what Player hands to the engine
  mime?: string;                    // for <video src>
  mode: PlaybackMode;               // declared by adapter, not inferred
  playSessionId?: string;           // Jellyfin PlaySessionId, for telemetry
  audioTracks: TrackInfo[];         // adapter-filtered (no unplayable)
  subtitleTracks: TrackInfo[];      // text-based only, side-loadable
  burnableSubtitleTracks: TrackInfo[]; // image-based, require transcode to render
  activeLevel?: { height: number; bitrate: number };

  changeQuality?(plan: PlaybackPlan): Promise<PlaybackSession>;
  close?(): Promise<void>;          // release transcode session, stop telemetry
}

interface TrackInfo {
  id: number;
  name: string;
  lang: string;
  codec?: string;
  isExternal?: boolean;
}
```

### How Jellyfin implements it

The adapter **never hand-builds a `master.m3u8` URL**. It calls the negotiation endpoint and uses what Jellyfin returns.

```ts
async negotiatePlayback(item, plan, caps) {
  const profile = buildDeviceProfile(caps, plan); // codec-honest, reflects plan
  const res = await fetch(`${config.url}/Items/${item.id}/PlaybackInfo`, {
    method: 'POST',
    headers: { /* auth, content-type */ },
    body: JSON.stringify({
      UserId: userCred.externalUserId,
      DeviceProfile: profile,
      MaxStreamingBitrate: plan.maxBitrate,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
    })
  });
  const info = await res.json();
  const source = info.MediaSources[0];

  // Jellyfin returns a fully-built TranscodingUrl with its decided plan baked in.
  // We use it verbatim — no query-string editing in Nexus.
  const url = source.TranscodingUrl
    ? `${config.url}${source.TranscodingUrl}`
    : buildDirectPlayUrl(source);

  return {
    engine: 'hls',
    url: proxyThroughRust(url),
    mode: derivePlaybackMode(source, info),  // direct-play | remux | direct-stream | transcode
    playSessionId: info.PlaySessionId,
    audioTracks: filterTextAudioTracks(source.MediaStreams),
    subtitleTracks: filterTextSubtitles(source.MediaStreams),
    burnableSubtitleTracks: filterImageSubtitles(source.MediaStreams),
    changeQuality: (newPlan) => this.negotiatePlayback(item, newPlan, caps),
    close: () => reportPlaybackStopped(info.PlaySessionId),
  };
}
```

**Key decisions baked in:**

- **`POST /Items/{id}/PlaybackInfo`** is the negotiation authority. Query-param variants of `master.m3u8` are deprecated in 10.11 and we stop using them.
- **`TranscodingUrl` is used verbatim.** It already contains Jellyfin's decided plan including `TranscodeReasons`. No Nexus-side param tweaking.
- **The browser's honest codec list** flows in via `BrowserCaps` at session start and gets converted to a `DeviceProfile`. If the browser can't decode AC3/EAC3/DTS, the profile says so, and Jellyfin transcodes to AAC instead of direct-streaming silence.
- **Four modes, not three.** `PlaybackMode` distinguishes `remux` (container change only) from `direct-stream` (audio transcode only) from `transcode` (video transcode). The player pill reflects this.
- **Quality changes re-negotiate.** `changeQuality()` calls `negotiatePlayback()` again with a tighter plan. Jellyfin always decides — Nexus never guesses. Cost: one ~200ms round-trip per quality change, invisible next to the buffer flush that already happens.
- **`close()` reports playback-stopped** via `POST /Sessions/Playing/Stopped` so Jellyfin tears down the transcode session promptly. Confirmed load-bearing: `PlaystateController.ReportPlaybackStopped` calls `_transcodeManager.KillTranscodingJobs(...)` on the `PlaySessionId`.
- **Session keepalive** via `POST /Sessions/Playing/Ping` during long pauses or slow scrubbing. Jellyfin's `PlaystateController.Ping` calls `_transcodeManager.PingTranscodingJob(...)` on the `PlaySessionId`. Without periodic pings, Jellyfin may reap the transcode session after its inactivity timeout. Cadence: every 15s when playback is paused and every 30s during active playback, handled by a shared `telemetryLoop` in the contract implementation, not per-adapter.

### How Invidious implements it

```ts
async negotiatePlayback(item, plan, caps) {
  // Fetch formats, pick the best itag for the browser + plan
  const formats = await fetchVideoFormats(videoId);
  const muxed = pickMuxedFormat(formats, caps, plan);
  return {
    engine: 'progressive',  // muxed MP4/WebM, <video src=...>
    url: `/api/stream/invidious/${videoId}?itag=${muxed.itag}`,
    mime: muxed.mimeType,
    mode: 'direct-play',  // YouTube CDN serves pre-transcoded
    audioTracks: [{ id: 0, name: 'Default', lang: muxed.language ?? '' }],
    subtitleTracks: await fetchCaptions(videoId),
    burnableSubtitleTracks: [],
    changeQuality: async (newPlan) => {
      const next = pickMuxedFormat(formats, caps, newPlan);
      return { ...this, url: `/api/stream/invidious/${videoId}?itag=${next.itag}` };
    }
  };
}
```

No server-side encoding, no ffmpeg, no transcoding. Just itag selection over a fixed list.

## Rust proxy

Grow the existing `stream-proxy/` crate (633 LOC, Invidious-only today, not wired into Docker) into the single byte pipe for all playback.

**Shape:**

- Binary: `nexus-stream-proxy`. Listens on `127.0.0.1:3939`.
- Stack: **hyper 1.x end-to-end**. Not axum. Full backpressure control, no middleware body-conversion traps.
- HTTP surface:
  - `POST /session` — body is a `ProxySession { upstream_url, auth_headers, rewrite_rules }`. Returns `{ session_id, stream_url }`. HMAC-signed session IDs with a short TTL.
  - `GET /stream/{id}` — opens upstream, pipes bytes via `reqwest::Response::bytes_stream()` into the hyper response. `Range:` passthrough. Zero application-level buffering.
  - `GET /stats` — existing stats endpoint, kept.
- **Credential stripping.** Jellyfin's `TranscodingUrl` contains `?...&ApiKey=<token>&...` (lowercase `api_key` in older versions). The proxy MUST strip both casings from any URL it emits to the browser (session creation URL, rewritten manifest URIs) and inject the token into upstream requests via the `auth_headers` on the session. The browser never sees a Jellyfin admin token. This is the whole point of having a proxy-as-auth-boundary.
- **HLS manifest rewriting** via the `m3u8-rs` crate — a proper HLS-spec parser, not regex. Rewrites variant playlist URIs to point at the proxy origin, strips `ApiKey`/`api_key` query params from segment URIs, fixes Jellyfin's bogus `BANDWIDTH=` values, preserves `EXT-X-STREAM-INF` attributes correctly. Handles `#EXT-X-BYTERANGE`, `#EXT-X-MEDIA:TYPE=AUDIO|SUBTITLES` alternate renditions, and `#EXT-X-KEY` encryption URIs — all verified supported by `m3u8-rs`.
- **Invidious-specific code** (CDN resolver, companion redirect chasing, per-video stats tracking) stays as a module inside the same binary. The existing 633-line `main.rs` is refactored into `src/handlers/invidious.rs`, `src/handlers/hls.rs`, `src/handlers/generic.rs`, `src/proxy.rs`, `src/session.rs`, `src/main.rs`. Same code, new layout.
- **Auth model:** Node SvelteKit still gates all playback. When a user starts playback, SvelteKit calls `POST /session` on the local Rust proxy with the upstream URL and required auth headers, gets back a signed session ID, and hands the user a `GET /stream/{id}` URL. Rust validates the HMAC and that's it. Rust never touches SvelteKit session cookies.
- **Build profile:** `lto = true`, `codegen-units = 1`, `strip = true`. Existing `Cargo.toml` already has `lto = true`; the other two are new.

**Why it's fast:**

1. Segment delivery never crosses the Node event loop. Today Node fetches and pipes every `.ts` segment — single-threaded HTTP body stream, the exact workload Node is worst at. Rust does ~10 µs of overhead per request.
2. HLS master rewriting happens once per session on a tokio blocking thread, not synchronously in the SvelteKit request handler.
3. Connection pooling via `reqwest` keeps TCP connections to Jellyfin warm across segments.
4. No full-body collection anywhere in the pipeline. `Bytes` chunks forward upstream→downstream under hyper's backpressure.

**Build wiring:**

```dockerfile
# New stage at top of Dockerfile
FROM rust:1.83-alpine AS rust-build
RUN apk add --no-cache musl-dev
COPY stream-proxy /stream-proxy
WORKDIR /stream-proxy
RUN cargo build --release

# runtime stage copies the binary
COPY --from=rust-build /stream-proxy/target/release/nexus-stream-proxy /app/bin/nexus-stream-proxy
```

**Supervisor:** `hooks.server.ts` spawns the binary at startup on 127.0.0.1:3939, watches it, restarts on exit. Crash-loop protection: if the binary exits 3 times in 30s, fall back to the existing Node proxy path with a warning log (`[fallback-node-proxy]`).

**Local dev:** `pnpm dev` shells out to `cargo run --release -p nexus-stream-proxy` in a sidecar. If `cargo` isn't installed, Node proxy path with a startup warning.

## NexusPlayer component

One Svelte 5 component, engine dispatched at runtime.

```
src/lib/components/player/
  NexusPlayer.svelte          ← chrome, controls, UI state
  TrailerPlayer.svelte        ← thin wrapper for inline trailers (~50 LOC)
  engines/
    PlayerEngine.ts           ← shared interface
    hls-engine.ts             ← hls.js glue
    dash-engine.ts            ← dash.js glue
    progressive-engine.ts     ← native <video src> glue
  PlayerState.svelte.ts       ← runes store: currentTime, quality, pill, stall metrics
  networkMonitor.ts           ← stall detection + bandwidth measurement
  QualityMenu.svelte          ← the one subtitle/audio/quality UI, shared
  AudioMenu.svelte
  SubtitleMenu.svelte
  errorCopy.ts                ← user-facing error text (no raw hls.js enums)
```

**`PlayerEngine` interface:**

```ts
interface PlayerEngine {
  attach(video: HTMLVideoElement, session: PlaybackSession): Promise<void>;
  detach(): void;
  levels: Level[];
  activeLevelIndex: number;   // -1 for auto
  setLevel(index: number): void;
  bandwidthEstimate(): number; // bits/sec, for networkMonitor
  onLevelSwitched(cb: (lvl: Level) => void): () => void;
  onStall(cb: (metric: StallMetric) => void): () => void;
  onFatalError(cb: () => void): () => void;
}
```

**Key decisions:**

- **Engines never build URLs.** The engine is given a `PlaybackSession.url` and uses it verbatim. Quality changes go through `session.changeQuality(plan)`, which calls back into the adapter. The `Player.svelte` line-643 pattern of `hls.loadSource(streamUrl + '?MaxStreamingBitrate=' + preset.bitrate)` is extinct.
- **Controls chrome survives** — keyboard shortcuts, touch gestures, theater toggle, fullscreen, progress reporting, scrub preview — but is lifted out of `Player.svelte` textually into `NexusPlayer.svelte` with minimal edits.
- **Audio/subtitle track lists come from `session`** pre-filtered by the adapter. The player never fetches tracks itself. `fetchExternalSubtitles()` is deleted.
- **Progress reporting** (the Jellyfin `/Sessions/Playing/Progress` POSTs that already happen) gets a `PlayMethod` field set from `session.mode`, so Jellyfin's dashboard shows the real mode.

**What gets deleted from `Player.svelte`:**

- The `mode: 'hls' | 'direct'` prop and ~150 lines of branching.
- `directFormats` + `switchDirectQuality` — moves to `progressive-engine.ts` at ~80 LOC.
- `QUALITY_PRESETS` constant — moves to per-adapter knowledge (Jellyfin presets live in the Jellyfin adapter since they're a function of Jellyfin's bitrate ladder).
- `selectedBitrate` state, `hlsUrl` derived, all hand-built query strings.
- The `if (dashPlayer) ... else if (hls) ... else if (isDirectMode)` branching throughout.

Target: ~2,299 LOC → ~900 LOC across ~8 files, each ≤300.

## Network-adaptive Auto mode

Two tiers, stacked.

**Tier 1 — manifest-level ABR (inside hls.js / dash.js).** Free, existing — but **almost never fires for Jellyfin**. Jellyfin's `DynamicHlsHelper.cs` suppresses ABR variant emission when the client is on the local network, when output uses copy codecs (remux/direct-stream), or when no video bitrate is requested. Even when all conditions pass, the "ladder" is three rungs: base, base − variation, base − 2×variation, where variation is a coarse step (2 Mbps at ≥10 Mbps total, 1.5 Mbps at ≥5 Mbps, 1 Mbps at ≥3 Mbps). So for parker's default case — local LAN, direct-stream — Jellyfin emits a single-variant playlist regardless of `EnableAdaptiveBitrateStreaming=true`. Tier 1 is effectively dead for the most common Nexus deployment.

**Tier 2 — cross-session renegotiation (primary adaptation mechanism).** When the engine reports sustained stalls (≥2 buffers >3s in a 30s window, or hls.js `FRAG_LOAD_EMERGENCY_ABORTED`), `networkMonitor` fires. Player calls `session.changeQuality({ targetHeight: nextLower, maxBitrate: measured * 0.8 })`, the adapter re-negotiates with Jellyfin via `POST /Items/{id}/PlaybackInfo`, and the engine reloads from saved `currentTime`. The pill may change from `DIRECT` to `TRANSCODE` — user sees it.

Because Jellyfin won't emit a ladder in the common case, Tier 2 is doing the work ABR would normally do on other media servers. This is intentional: Jellyfin's own position is that client-side ABR on a local network "will likely do more harm than good," and cross-session renegotiation gives us cleaner state (one engine, one URL, one variant at a time) at the cost of a ~200ms round-trip per adaptation event.

**Ramp-back-up:** after 60s of stable playback with measured bandwidth comfortably above the required rate of the next tier up, the player offers a `Try 1080p?` toast. Never auto-forces a re-up.

**`networkMonitor` state (rune store):**

```ts
measuredBandwidth: number;     // moving average from active engine
stallEvents: StallMetric[];    // ring buffer, 30s window
lastAdaptation: Date;          // rate-limit: don't adapt more than once per 15s
```

## Subtitle policy

**Default: zero burn-in, always.** The adapter's negotiation request sets `SubtitleStreamIndex=-1` and `SubtitleMethod=Hls`. Jellyfin never bakes a sub into the video stream. The player side-loads text tracks via `<track>` elements, toggles them client-side, zero backend involvement.

**Main subtitle menu** lists text-based tracks (SRT, ASS, VTT). Adapter filters image-based tracks (PGS, PGSSUB, DVB, DVDSUB, VOBSUB) out of this list.

**Collapsed submenu:** `Show image-based subs (transcode required)`. Expanding it reveals a labeled list:

```
[BURN-IN · forces transcode]  English (PGS)
[BURN-IN · forces transcode]  Spanish (PGS)
```

Picking one fires `session.changeQuality({ burnSubIndex: 4 })`. The adapter returns a new session with `SubtitleStreamIndex=4` and `SubtitleMethod=Encode`. Jellyfin burns the sub into the video and transcodes. The pill updates to `TRANSCODE · burn-in`.

Switching back to a text sub or Off returns to direct-stream.

**Lint gate:** grep for `SubtitleStreamIndex` passed to any `master.m3u8` request outside the `burnSubIndex` codepath. CI fails the build if found. Prevents regressions.

## Component inventory & cleanup

| Current | Lines | Becomes |
|---|---|---|
| `Player.svelte` | 2299 | **Deleted.** Replaced by `NexusPlayer.svelte` + `engines/*` + menus. |
| `TrailerPlayer.svelte` | 204 | Kept, rewritten to ~50-line thin wrapper using engines. |
| `HeroCarousel.svelte` (bg video) | 270 | Left alone. Ambient decoration, not a player. |

**Shared infra created:**
- `src/lib/components/player/engines/` — hls / dash / progressive glue
- `src/lib/components/player/PlayerState.svelte.ts` — rune store
- `src/lib/components/player/networkMonitor.ts` — stall + bandwidth
- `src/lib/components/player/errorCopy.ts` — user-facing error strings

## Privacy egress cleanup

**Policy:** the user's browser never opens a connection to anything that isn't Nexus. Adapters may call third parties server-side; the browser cannot.

**Audit scope:**
1. **Fonts.** Currently `app.html` preconnects to `fonts.googleapis.com` + `fonts.gstatic.com` for Playfair Display, DM Sans, JetBrains Mono. Fix: install `@fontsource/playfair-display`, `@fontsource/dm-sans`, `@fontsource-variable/jetbrains-mono` as deps, import from `+layout.svelte`, delete the `app.html` preconnect + stylesheet links. CSP tightens to `font-src 'self'`.
2. **Image origins.** Grep for `<img src=` with absolute http(s) URLs. Anything pointing at a third-party CDN routes through a Nexus proxy endpoint (new or existing).
3. **Scripts / stylesheets.** Grep `app.html` + `+layout.svelte` for any `<script src=` or `<link rel="stylesheet">` with a non-relative URL. Must be zero.
4. **`fetch()` absolute URLs in client code.** Anything client-side calling `fetch('https://...')` moves to server-side routing.
5. **WebSocket.** `/api/ws` stays Nexus-origin; third-party WS forbidden.

**CI lint:** grep the built `_app/immutable/` bundle for `googleapis|gstatic|ytimg|youtube\\.com|googlevideo` — fail the build if found. Prevents silent regressions.

**CSP via SvelteKit's `kit.csp` config** (static policy). Don't also set the header manually in `hooks.server.ts` — the two can produce conflicting policy enforcement. `hooks.server.ts` is only appropriate if we need per-request dynamic CSP values, which we don't.

```js
// svelte.config.js
kit: {
  csp: {
    mode: 'auto',
    directives: {
      'default-src': ['self'],
      'script-src': ['self'],
      'style-src': ['self', 'unsafe-inline'],
      'img-src': ['self', 'data:', 'blob:'],
      'font-src': ['self'],
      'media-src': ['self', 'blob:'],
      'connect-src': ['self', 'ws:'],
      'frame-ancestors': ['none']
    }
  }
}
```

## Phasing

**Phase 1 — Rust proxy goes live, nothing user-visible changes.**
- Build the Rust binary in Docker.
- Node proxy rewrites to call `POST /session` on `127.0.0.1:3939` and hand off to Rust.
- Existing query-param injection stays on the Node side temporarily — this phase is pure plumbing.
- Fallback path: if binary missing or crashes, Node proxy still works. `[fallback-node-proxy]` log tag.
- **Exit:** a 20 MB Jellyfin HLS segment downloads through Nexus at LAN line rate. `curl` benchmark included in the phase's PR.

**Phase 2 — The contract lands.**
- Define the contract types in `src/lib/adapters/contract.ts`.
- Implement `negotiatePlayback` on Jellyfin using `POST /Items/{id}/PlaybackInfo` + `DeviceProfile` + `TranscodingUrl`. The existing `master.m3u8` URL construction in `/api/stream/[serviceId]/[...path]/+server.ts` stops being called.
- Implement `negotiatePlayback` on Invidious (translates existing `/api/video/stream/[videoId]` path into a `PlaybackSession`).
- New endpoint `POST /api/play/negotiate` exposes the contract to the client.
- Callers of the old pattern still work — contract is additive.
- **Exit:** `curl POST /api/play/negotiate` returns a valid `PlaybackSession` for a Jellyfin movie and an Invidious video.

**Phase 3 — `NexusPlayer` replaces `Player.svelte`.**
- Build `player/*` from scratch alongside existing `Player.svelte`.
- Cut `/media/movie/[id]` to use `NexusPlayer` + `POST /api/play/negotiate`. Verify on parker's stack: direct-stream, 720p-capped transcode, stall-triggered tier drop, side-loaded subs, burn-in submenu, mode pill.
- Cut `/videos/*` (Invidious).
- Cut `/media/episode/*`.
- Rewrite `TrailerPlayer.svelte` as the thin wrapper.
- Delete `Player.svelte`, `QUALITY_PRESETS`, `selectedBitrate`, `mode: 'hls' | 'direct'` prop, hand-built URL sites, `fetchExternalSubtitles`, the obsolete query-param injection in `/api/stream/[serviceId]/[...path]/+server.ts`.
- **Exit:** `grep -r "Player.svelte" src` returns zero imports. 2,299 LOC → ~900 LOC across the new files.

**Phase 4 — Privacy egress cleanup.**
- Install `@fontsource/*`, import from layout, delete the `app.html` preconnect + stylesheet links.
- Audit image/script/fetch/WebSocket origins, fix or proxy each hit.
- Add CSP headers.
- Add CI lint against the build artifact.
- **Exit:** loading `/` with devtools network tab → zero requests to any non-Nexus origin.

Phases ship independently. 1/2 are invisible to users, 3 is the big user-facing change, 4 is orthogonal and can land in any order.

## Deployment topology

Nexus ships to a range of setups. The architecture is topology-agnostic by construction — the same contract, proxy, and player work everywhere. What *does* vary is which adaptation mechanism carries the load and how much speed win the Rust proxy delivers. The design must behave gracefully across all four common shapes:

| Topology | Upstream RTT | Jellyfin ABR emits ladder? | Tier 1 ABR | Tier 2 renegotiation | Rust proxy win |
|---|---|---|---|---|---|
| **Same-host loopback** | ~0 ms | No (local network suppression) | Dead | Primary | Per-segment CPU overhead, not latency |
| **Same-LAN separate hosts** | <5 ms | No (same local subnet → local) | Dead | Primary | Connection pooling + backpressure, modest |
| **Remote Jellyfin over VPN/Tailscale** | 50-300 ms | Yes (3-rung ladder per `DynamicHlsHelper.cs`) | Active | Backup | Significant — avoids Node fetch stall on high-latency upstream |
| **Reverse-proxied public Jellyfin** | 30-150 ms | Yes (non-local) | Active | Backup | Significant |

**Why this matters for the design:**

- **No topology-specific code paths.** The adapter submits the same `DeviceProfile` with `EnableAdaptiveBitrateStreaming=true` regardless. Jellyfin decides per-request whether to emit a ladder based on its own local-network detection. The client handles both cases identically.
- **Tier 2 renegotiation is always wired in and always correct.** It's the primary adaptation mechanism for local topologies (where Tier 1 is dead by Jellyfin's design) and the fall-back for remote topologies (where Tier 1 handles fine-grain adaptation within the 3-rung ladder and Tier 2 handles larger drops). Tier 2 is never "disabled" — it just fires rarely on topologies where Tier 1 is doing its job.
- **The Rust proxy is a net positive on every topology**, but the magnitude varies. Per-segment CPU overhead reduction (same-host), connection pooling (same-LAN), avoiding Node fetch stalls (remote), and backpressure correctness (all of them) add up differently per deployment. Never a regression.
- **The mode pill, the burn-in submenu, the self-hosted fonts, and the CSP lockdown are topology-agnostic.** Privacy doesn't depend on where your Jellyfin runs.

**Validation during Phase 1** — benchmark the Rust proxy against the Node proxy on the *same* upstream for an apples-to-apples comparison:

1. `curl` 20 MB of HLS segment through the existing Node proxy path, record MB/s.
2. Same URL, same upstream, through the Rust proxy path, record MB/s.
3. Repeat on at least two topologies you have access to (dev and a same-LAN target if available) so we see the win shape, not just a single data point.

Never compare "dev stack with Tailscale" against "prod stack with loopback" and conclude anything about the proxy — those numbers differ for reasons that have nothing to do with Nexus.

## Open questions

None. All design decisions resolved interactively:
- Four modes (direct-play / remux / direct-stream / transcode), not three — confirmed by Jellyfin's own docs.
- Quality changes renegotiate on every switch via `POST /Items/{id}/PlaybackInfo`, not edit master.m3u8 URLs — confirmed as "Y always."
- `EnableAdaptiveBitrateStreaming=true` in DeviceProfile so ABR has something to adapt between.
- Hyper end-to-end for the Rust proxy, not axum.
- Optional burn-in subs allowed behind explicit labeling; never default.
- Self-hosted fonts via `@fontsource`; CSP tightened; CI lint gate.

## Appendix: concrete `DeviceProfile` for MSE browsers

Distilled from Jellyfin Web's `scripts/browserDeviceProfile.js` pattern plus research findings. Minimal and load-bearing only.

```json
{
  "Name": "Nexus MSE Browser",
  "MaxStreamingBitrate": 120000000,
  "MaxStaticBitrate": 100000000,

  "DirectPlayProfiles": [
    {
      "Container": "mp4,m4v",
      "Type": "Video",
      "VideoCodec": "h264,hevc,av1",
      "AudioCodec": "aac,mp3,ac3,eac3,opus"
    },
    {
      "Container": "webm",
      "Type": "Video",
      "VideoCodec": "vp8,vp9,av1",
      "AudioCodec": "vorbis,opus"
    },
    {
      "Container": "hls",
      "Type": "Video",
      "VideoCodec": "h264,hevc,av1",
      "AudioCodec": "aac,mp3"
    }
  ],

  "TranscodingProfiles": [
    {
      "Container": "mp4",
      "Type": "Video",
      "Context": "Streaming",
      "Protocol": "hls",
      "VideoCodec": "h264,hevc,av1",
      "AudioCodec": "aac,mp3",
      "MaxAudioChannels": "2",
      "MinSegments": 1,
      "BreakOnNonKeyFrames": true
    },
    {
      "Container": "ts",
      "Type": "Video",
      "Context": "Streaming",
      "Protocol": "hls",
      "VideoCodec": "h264",
      "AudioCodec": "aac,mp3",
      "MaxAudioChannels": "2",
      "MinSegments": 1,
      "BreakOnNonKeyFrames": true
    }
  ],

  "ContainerProfiles": [],
  "CodecProfiles": [],
  "SubtitleProfiles": []
}
```

**Intentional omissions:**
- **MKV direct-play.** Known footgun: Jellyfin Web advertised MKV and users hit `DirectPlayError` when the browser couldn't actually handle the source file. Leaving it off forces Jellyfin into HLS remux/transcode for MKV sources, which always works.
- **Opus in the HLS transcoding profile.** Safari can't decode Opus-in-fMP4 (it can decode standalone Opus but not inside an MP4 HLS segment). Keeping Opus only in the WebM direct-play profile where it's native.
- **`ResponseProfiles`.** Removed from the modern `DeviceProfile` model in 10.11; no longer load-bearing.
- **`ContainerProfiles` / `CodecProfiles` / `SubtitleProfiles`.** Empty for the minimal profile. Can add constraints (e.g., `Max height`, `RefFrames`) later if Nexus hits specific compatibility walls. Starting minimal is safer than starting with wrong constraints.

**The `"Container": "hls"` direct-play entry is intentional and follows Jellyfin Web's own pattern.** The Jellyfin API has no way to express "HLS protocol with MP4 vs TS sub-container" in the standard profile schema, so Jellyfin Web uses this hack with comment `hack of an entry to indicate that we support HLS`. Nexus mirrors it for compatibility.

## Appendix: decisions this design explicitly kills

- Nexus-side ffmpeg. Not today, not ever. Transcoding lives on the media server.
- Hand-built `master.m3u8` URLs. Replaced by `POST /Items/{id}/PlaybackInfo` + `TranscodingUrl` verbatim.
- `Player.svelte`'s `mode: 'hls' | 'direct'` prop. Replaced by `session.engine`.
- Collapsing remux / direct-stream into one "direct" bucket. Four modes, not three.
- Client-side `SubtitleStreamIndex` forwarding to `master.m3u8`. Side-loaded tracks only, except behind an explicit user-confirmed burn-in toggle.
- Browser requests to `fonts.googleapis.com` or any third-party origin. CSP + CI gate.
- The Node-proxy hot path for HLS segments. Rust byte pipe in the supervisor.
