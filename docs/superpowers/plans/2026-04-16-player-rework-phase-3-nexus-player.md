# Player Rework — Phase 3 — NexusPlayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2,299-line `Player.svelte` with a new `NexusPlayer.svelte` that dispatches to pluggable engine modules (hls/dash/progressive), uses the Phase 2 `PlaybackSession` contract, and shows the user what's actually happening (mode pill, real quality label, honest sub/audio menus). Cut over all 3 call sites in the media detail page, rewrite TrailerPlayer as a thin wrapper, delete the old Player.

**Architecture:** `NexusPlayer.svelte` is the chrome (controls, gestures, keyboard shortcuts). It receives a `PlaybackSession` and lazy-loads the right engine module based on `session.engine`. Engines implement a shared `PlayerEngine` interface. Quality changes call `session.changeQuality()` — the adapter re-negotiates with the server, the engine reloads. A `PlayerState` rune store holds all reactive state. The BrowserCaps probe runs once at boot via `MediaSource.isTypeSupported`.

**Tech Stack:** Svelte 5 (runes), TypeScript, hls.js, dash.js (existing deps), vitest.

**Spec:** `docs/superpowers/specs/2026-04-15-player-streaming-rework-design.md`, Sections 4 (NexusPlayer), 5 (adaptive auto), 6 (subtitles), 7 (component inventory).

---

## File structure

**New files:**

| Path | Responsibility |
|---|---|
| `src/lib/components/player/PlayerEngine.ts` | Shared engine interface |
| `src/lib/components/player/engines/hls-engine.ts` | hls.js glue |
| `src/lib/components/player/engines/dash-engine.ts` | dash.js glue |
| `src/lib/components/player/engines/progressive-engine.ts` | native `<video src>` glue |
| `src/lib/components/player/PlayerState.svelte.ts` | Rune store for all player state |
| `src/lib/components/player/networkMonitor.ts` | Stall detection + bandwidth measurement |
| `src/lib/components/player/QualityMenu.svelte` | Quality selector submenu |
| `src/lib/components/player/AudioMenu.svelte` | Audio track submenu |
| `src/lib/components/player/SubtitleMenu.svelte` | Subtitle submenu (text + burn-in) |
| `src/lib/components/player/ModePill.svelte` | DIRECT / REMUX / AUDIO-TX / TRANSCODE pill |
| `src/lib/components/player/NexusPlayer.svelte` | Main player shell (controls, chrome, gestures) |
| `src/lib/components/player/browserCaps.ts` | One-time MSE.isTypeSupported probe |
| `src/lib/components/player/errorCopy.ts` | User-facing error strings |

**Modified files:**

| Path | Change |
|---|---|
| `src/routes/media/[type]/[id]/+page.svelte` | Replace Player imports with NexusPlayer; call POST /api/play/negotiate |
| `src/routes/media/[type]/[id]/+page.server.ts` | Remove videoStreamUrl/videoFormats server-side fetching (NexusPlayer handles it client-side via the contract) |
| `src/lib/components/HeroSection.svelte` | Replace TrailerPlayer with thin NexusPlayer wrapper |
| `src/lib/components/TrailerPlayer.svelte` | Rewrite as thin wrapper around NexusPlayer engines |

**Deleted files:**

| Path | Reason |
|---|---|
| `src/lib/components/Player.svelte` | Replaced by NexusPlayer |
| `src/lib/components/QualityBadge.svelte` | Replaced by ModePill |

---

## Task 1 — PlayerEngine interface + BrowserCaps probe

**Files:**
- Create: `src/lib/components/player/PlayerEngine.ts`
- Create: `src/lib/components/player/browserCaps.ts`
- Create: `src/lib/components/player/errorCopy.ts`

- [ ] **Step 1: Create `PlayerEngine.ts`**

```ts
import type { PlaybackSession, TrackInfo } from '$lib/adapters/playback';

export interface Level {
	index: number;
	height: number;
	bitrate: number;
}

export interface StallMetric {
	timestamp: number;
	duration: number;
}

export interface PlayerEngine {
	attach(video: HTMLVideoElement, session: PlaybackSession): Promise<void>;
	detach(): void;
	readonly levels: Level[];
	readonly activeLevelIndex: number;
	setLevel(index: number): void; // -1 = auto
	bandwidthEstimate(): number; // bits/sec
	onLevelSwitched(cb: (lvl: Level) => void): () => void;
	onStall(cb: (metric: StallMetric) => void): () => void;
	onFatalError(cb: () => void): () => void;
}
```

- [ ] **Step 2: Create `browserCaps.ts`**

```ts
import type { BrowserCaps } from '$lib/adapters/playback';

const CODEC_PROBES = {
	video: [
		{ codec: 'avc1.640028', mime: 'video/mp4; codecs="avc1.640028"' },
		{ codec: 'avc1.4d401e', mime: 'video/mp4; codecs="avc1.4d401e"' },
		{ codec: 'hev1.1.6.L93.B0', mime: 'video/mp4; codecs="hev1.1.6.L93.B0"' },
		{ codec: 'hvc1.1.6.L93.B0', mime: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
		{ codec: 'av01.0.08M.08', mime: 'video/mp4; codecs="av01.0.08M.08"' },
		{ codec: 'vp9', mime: 'video/webm; codecs="vp9"' },
		{ codec: 'vp09.00.10.08', mime: 'video/webm; codecs="vp09.00.10.08"' },
		{ codec: 'vp8', mime: 'video/webm; codecs="vp8"' },
	],
	audio: [
		{ codec: 'mp4a.40.2', mime: 'audio/mp4; codecs="mp4a.40.2"' },
		{ codec: 'opus', mime: 'audio/webm; codecs="opus"' },
		{ codec: 'mp3', mime: 'audio/mpeg' },
		{ codec: 'flac', mime: 'audio/flac' },
		{ codec: 'vorbis', mime: 'audio/webm; codecs="vorbis"' },
	],
};

let cached: BrowserCaps | null = null;

export function probeBrowserCaps(): BrowserCaps {
	if (cached) return cached;

	const videoCodecs: string[] = [];
	const audioCodecs: string[] = [];
	const containers: string[] = [];

	if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported) {
		for (const probe of CODEC_PROBES.video) {
			if (MediaSource.isTypeSupported(probe.mime)) {
				videoCodecs.push(probe.codec);
			}
		}
		for (const probe of CODEC_PROBES.audio) {
			if (MediaSource.isTypeSupported(probe.mime)) {
				audioCodecs.push(probe.codec);
			}
		}
	} else {
		// Fallback: assume basic H.264 + AAC
		videoCodecs.push('avc1.640028');
		audioCodecs.push('mp4a.40.2');
	}

	// Container support
	const video = document.createElement('video');
	if (video.canPlayType('video/mp4')) containers.push('mp4');
	if (video.canPlayType('video/webm')) containers.push('webm');
	if (video.canPlayType('application/x-mpegURL') || video.canPlayType('application/vnd.apple.mpegURL')) {
		containers.push('ts');
	}
	if (!containers.includes('mp4')) containers.push('mp4'); // force at minimum
	if (!containers.includes('ts')) containers.push('ts');

	const maxHeight = Math.round(window.screen.height * (window.devicePixelRatio ?? 1));

	cached = { videoCodecs, audioCodecs, containers, maxHeight };
	return cached;
}
```

- [ ] **Step 3: Create `errorCopy.ts`**

```ts
export function playerErrorMessage(error: string | Error | unknown): string {
	const msg = error instanceof Error ? error.message : String(error ?? '');
	if (msg.includes('404')) return 'Stream not found. The media may have been removed.';
	if (msg.includes('403')) return 'Access denied. Try reconnecting your account.';
	if (msg.includes('timeout') || msg.includes('abort')) return 'The stream timed out. Check your connection.';
	if (msg.includes('decode') || msg.includes('codec')) return 'This format is not supported by your browser.';
	if (msg.includes('network') || msg.includes('fetch')) return 'Network error. Check your connection.';
	return 'Playback error. Try refreshing the page.';
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm check 2>&1 | grep -E "player/" | head -10`

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/player/
git commit -m "player: engine interface, browser caps probe, error copy"
```

---

## Task 2 — HLS engine

**Files:**
- Create: `src/lib/components/player/engines/hls-engine.ts`

- [ ] **Step 1: Create the engine**

```ts
import type { PlayerEngine, Level, StallMetric } from '../PlayerEngine';
import type { PlaybackSession } from '$lib/adapters/playback';

export async function createHlsEngine(): Promise<PlayerEngine> {
	const Hls = (await import('hls.js')).default;

	let hls: InstanceType<typeof Hls> | null = null;
	let videoEl: HTMLVideoElement | null = null;
	let levels: Level[] = [];
	let activeLevelIndex = -1;
	const levelCallbacks: ((lvl: Level) => void)[] = [];
	const stallCallbacks: ((m: StallMetric) => void)[] = [];
	const errorCallbacks: (() => void)[] = [];

	return {
		async attach(video, session) {
			videoEl = video;
			video.crossOrigin = 'anonymous';

			if (!Hls.isSupported()) {
				// Safari native HLS fallback
				video.src = session.url;
				return;
			}

			hls = new Hls({
				maxBufferLength: 60,
				maxMaxBufferLength: 120,
				startLevel: -1,
				abrEwmaDefaultEstimate: 50_000_000,
				enableWorker: true,
				lowLatencyMode: false,
				debug: false,
			});

			hls.loadSource(session.url);
			hls.attachMedia(video);

			hls.on(Hls.Events.MANIFEST_PARSED, (_: unknown, data: { levels: { height: number; bitrate: number }[] }) => {
				levels = data.levels.map((l, i) => ({
					index: i,
					height: l.height ?? 0,
					bitrate: l.bitrate ?? 0,
				}));
				if (levels.length > 1) {
					hls!.nextLevel = levels.length - 1;
				}
			});

			hls.on(Hls.Events.LEVEL_SWITCHED, (_: unknown, data: { level: number }) => {
				activeLevelIndex = hls!.autoLevelEnabled ? -1 : data.level;
				const lvl = levels[data.level];
				if (lvl) levelCallbacks.forEach((cb) => cb(lvl));
			});

			hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; type: string }) => {
				if (data.type === 'networkError') {
					stallCallbacks.forEach((cb) => cb({ timestamp: Date.now(), duration: 0 }));
				}
				if (data.fatal) {
					errorCallbacks.forEach((cb) => cb());
				}
			});

			hls.on(Hls.Events.FRAG_LOAD_EMERGENCY_ABORTED, () => {
				stallCallbacks.forEach((cb) => cb({ timestamp: Date.now(), duration: 3000 }));
			});
		},

		detach() {
			if (hls) { hls.destroy(); hls = null; }
			levels = [];
			activeLevelIndex = -1;
		},

		get levels() { return levels; },
		get activeLevelIndex() { return activeLevelIndex; },

		setLevel(index: number) {
			if (!hls) return;
			if (index === -1) {
				hls.currentLevel = -1;
			} else {
				hls.currentLevel = index;
			}
			activeLevelIndex = index;
		},

		bandwidthEstimate() {
			return hls?.bandwidthEstimate ?? 0;
		},

		onLevelSwitched(cb) {
			levelCallbacks.push(cb);
			return () => { const i = levelCallbacks.indexOf(cb); if (i >= 0) levelCallbacks.splice(i, 1); };
		},

		onStall(cb) {
			stallCallbacks.push(cb);
			return () => { const i = stallCallbacks.indexOf(cb); if (i >= 0) stallCallbacks.splice(i, 1); };
		},

		onFatalError(cb) {
			errorCallbacks.push(cb);
			return () => { const i = errorCallbacks.indexOf(cb); if (i >= 0) errorCallbacks.splice(i, 1); };
		},
	};
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/player/engines/hls-engine.ts
git commit -m "player: HLS engine (hls.js glue)"
```

---

## Task 3 — Progressive + DASH engines

**Files:**
- Create: `src/lib/components/player/engines/progressive-engine.ts`
- Create: `src/lib/components/player/engines/dash-engine.ts`

- [ ] **Step 1: Create progressive engine**

```ts
import type { PlayerEngine, Level, StallMetric } from '../PlayerEngine';
import type { PlaybackSession } from '$lib/adapters/playback';

export function createProgressiveEngine(): PlayerEngine {
	let videoEl: HTMLVideoElement | null = null;
	const stallCallbacks: ((m: StallMetric) => void)[] = [];
	const errorCallbacks: (() => void)[] = [];
	let stalledTimer: ReturnType<typeof setTimeout> | null = null;

	return {
		async attach(video, session) {
			videoEl = video;
			video.src = session.url;
			if (session.mime) video.type = session.mime;

			video.addEventListener('stalled', () => {
				stalledTimer = setTimeout(() => {
					stallCallbacks.forEach((cb) => cb({ timestamp: Date.now(), duration: 3000 }));
				}, 3000);
			});
			video.addEventListener('playing', () => {
				if (stalledTimer) { clearTimeout(stalledTimer); stalledTimer = null; }
			});
			video.addEventListener('error', () => {
				errorCallbacks.forEach((cb) => cb());
			});
		},

		detach() {
			if (videoEl) { videoEl.removeAttribute('src'); videoEl.load(); }
			if (stalledTimer) clearTimeout(stalledTimer);
			videoEl = null;
		},

		get levels() { return []; },
		get activeLevelIndex() { return -1; },
		setLevel() {},
		bandwidthEstimate() { return 0; },
		onLevelSwitched() { return () => {}; },
		onStall(cb) {
			stallCallbacks.push(cb);
			return () => { const i = stallCallbacks.indexOf(cb); if (i >= 0) stallCallbacks.splice(i, 1); };
		},
		onFatalError(cb) {
			errorCallbacks.push(cb);
			return () => { const i = errorCallbacks.indexOf(cb); if (i >= 0) errorCallbacks.splice(i, 1); };
		},
	};
}
```

- [ ] **Step 2: Create DASH engine**

```ts
import type { PlayerEngine, Level, StallMetric } from '../PlayerEngine';
import type { PlaybackSession } from '$lib/adapters/playback';

export async function createDashEngine(): Promise<PlayerEngine> {
	const dashjs = await import('dashjs');

	let player: ReturnType<typeof dashjs.MediaPlayer> | null = null;
	let videoEl: HTMLVideoElement | null = null;
	let levels: Level[] = [];
	let activeLevelIndex = -1;
	const levelCallbacks: ((lvl: Level) => void)[] = [];
	const stallCallbacks: ((m: StallMetric) => void)[] = [];
	const errorCallbacks: (() => void)[] = [];

	return {
		async attach(video, session) {
			videoEl = video;
			player = dashjs.MediaPlayer().create();
			player.initialize(video, session.url, true);
			player.updateSettings({
				streaming: {
					abr: { autoSwitchBitrate: { video: true } },
					buffer: { fastSwitchEnabled: true },
				},
			});

			player.on('qualityChangeRendered', (_e: unknown) => {
				const idx = player!.getQualityFor('video');
				activeLevelIndex = idx;
				const bitrateList = player!.getBitrateInfoListFor('video') ?? [];
				levels = bitrateList.map((b: { qualityIndex: number; height: number; bitrate: number }, i: number) => ({
					index: i, height: b.height ?? 0, bitrate: b.bitrate ?? 0,
				}));
				const lvl = levels[idx];
				if (lvl) levelCallbacks.forEach((cb) => cb(lvl));
			});

			player.on('error', () => errorCallbacks.forEach((cb) => cb()));
			player.on('bufferStalled', () => {
				stallCallbacks.forEach((cb) => cb({ timestamp: Date.now(), duration: 3000 }));
			});
		},

		detach() {
			if (player) { player.reset(); player = null; }
			levels = [];
			activeLevelIndex = -1;
		},

		get levels() { return levels; },
		get activeLevelIndex() { return activeLevelIndex; },

		setLevel(index: number) {
			if (!player) return;
			if (index === -1) {
				player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
			} else {
				player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
				player.setQualityFor('video', index);
			}
			activeLevelIndex = index;
		},

		bandwidthEstimate() {
			return (player as any)?.getAverageThroughput?.('video') ?? 0;
		},

		onLevelSwitched(cb) {
			levelCallbacks.push(cb);
			return () => { const i = levelCallbacks.indexOf(cb); if (i >= 0) levelCallbacks.splice(i, 1); };
		},
		onStall(cb) {
			stallCallbacks.push(cb);
			return () => { const i = stallCallbacks.indexOf(cb); if (i >= 0) stallCallbacks.splice(i, 1); };
		},
		onFatalError(cb) {
			errorCallbacks.push(cb);
			return () => { const i = errorCallbacks.indexOf(cb); if (i >= 0) errorCallbacks.splice(i, 1); };
		},
	};
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/player/engines/
git commit -m "player: progressive + DASH engines"
```

---

## Task 4 — PlayerState rune store + network monitor

**Files:**
- Create: `src/lib/components/player/PlayerState.svelte.ts`
- Create: `src/lib/components/player/networkMonitor.ts`

- [ ] **Step 1: Create `PlayerState.svelte.ts`**

```ts
import type { PlaybackSession, PlaybackMode, TrackInfo } from '$lib/adapters/playback';
import type { Level } from './PlayerEngine';

export function createPlayerState() {
	let currentTime = $state(0);
	let duration = $state(0);
	let buffered = $state(0);
	let playing = $state(false);
	let volume = $state(1);
	let muted = $state(false);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// Quality / mode
	let mode = $state<PlaybackMode>('direct-play');
	let activeLevel = $state<Level | null>(null);
	let autoQuality = $state(true);
	let qualityLabel = $state('Auto');

	// Tracks
	let audioTracks = $state<TrackInfo[]>([]);
	let subtitleTracks = $state<TrackInfo[]>([]);
	let burnableSubtitleTracks = $state<TrackInfo[]>([]);
	let currentAudioTrack = $state(-1);
	let currentSubtitleTrack = $state(-1);
	let isBurnIn = $state(false);

	// Network
	let measuredBandwidth = $state(0);
	let stallCount = $state(0);

	// Controls
	let showControls = $state(true);
	let activePanel = $state<'none' | 'quality' | 'audio' | 'subtitles'>('none');

	function updateFromSession(session: PlaybackSession) {
		mode = session.mode;
		audioTracks = session.audioTracks;
		subtitleTracks = session.subtitleTracks;
		burnableSubtitleTracks = session.burnableSubtitleTracks;
		if (session.activeLevel) {
			activeLevel = { index: 0, ...session.activeLevel };
		}
	}

	function updateQualityLabel(levels: Level[], activeLevelIndex: number) {
		if (activeLevelIndex === -1 || autoQuality) {
			const h = activeLevel?.height;
			qualityLabel = h ? `Auto (${h}p)` : 'Auto';
		} else {
			const lvl = levels[activeLevelIndex];
			qualityLabel = lvl ? `${lvl.height}p` : 'Manual';
		}
	}

	return {
		get currentTime() { return currentTime; },
		set currentTime(v: number) { currentTime = v; },
		get duration() { return duration; },
		set duration(v: number) { duration = v; },
		get buffered() { return buffered; },
		set buffered(v: number) { buffered = v; },
		get playing() { return playing; },
		set playing(v: boolean) { playing = v; },
		get volume() { return volume; },
		set volume(v: number) { volume = v; },
		get muted() { return muted; },
		set muted(v: boolean) { muted = v; },
		get isLoading() { return isLoading; },
		set isLoading(v: boolean) { isLoading = v; },
		get error() { return error; },
		set error(v: string | null) { error = v; },
		get mode() { return mode; },
		get activeLevel() { return activeLevel; },
		set activeLevel(v: Level | null) { activeLevel = v; },
		get autoQuality() { return autoQuality; },
		set autoQuality(v: boolean) { autoQuality = v; },
		get qualityLabel() { return qualityLabel; },
		get audioTracks() { return audioTracks; },
		get subtitleTracks() { return subtitleTracks; },
		get burnableSubtitleTracks() { return burnableSubtitleTracks; },
		get currentAudioTrack() { return currentAudioTrack; },
		set currentAudioTrack(v: number) { currentAudioTrack = v; },
		get currentSubtitleTrack() { return currentSubtitleTrack; },
		set currentSubtitleTrack(v: number) { currentSubtitleTrack = v; },
		get isBurnIn() { return isBurnIn; },
		set isBurnIn(v: boolean) { isBurnIn = v; },
		get measuredBandwidth() { return measuredBandwidth; },
		set measuredBandwidth(v: number) { measuredBandwidth = v; },
		get stallCount() { return stallCount; },
		set stallCount(v: number) { stallCount = v; },
		get showControls() { return showControls; },
		set showControls(v: boolean) { showControls = v; },
		get activePanel() { return activePanel; },
		set activePanel(v: 'none' | 'quality' | 'audio' | 'subtitles') { activePanel = v; },
		updateFromSession,
		updateQualityLabel,
	};
}

export type PlayerState = ReturnType<typeof createPlayerState>;
```

- [ ] **Step 2: Create `networkMonitor.ts`**

```ts
import type { StallMetric } from './PlayerEngine';
import type { PlayerState } from './PlayerState.svelte';

const STALL_WINDOW_MS = 30_000;
const STALL_THRESHOLD = 2;
const ADAPTATION_COOLDOWN_MS = 15_000;

export function createNetworkMonitor(state: PlayerState) {
	const stallEvents: StallMetric[] = [];
	let lastAdaptation = 0;

	function recordStall(metric: StallMetric) {
		stallEvents.push(metric);
		state.stallCount = stallEvents.length;

		// Evict old events
		const cutoff = Date.now() - STALL_WINDOW_MS;
		while (stallEvents.length > 0 && stallEvents[0].timestamp < cutoff) {
			stallEvents.shift();
		}
	}

	function shouldAdapt(): boolean {
		if (Date.now() - lastAdaptation < ADAPTATION_COOLDOWN_MS) return false;
		const recent = stallEvents.filter((e) => e.timestamp > Date.now() - STALL_WINDOW_MS);
		return recent.length >= STALL_THRESHOLD;
	}

	function markAdapted() {
		lastAdaptation = Date.now();
		stallEvents.length = 0;
		state.stallCount = 0;
	}

	function updateBandwidth(bps: number) {
		state.measuredBandwidth = bps;
	}

	return { recordStall, shouldAdapt, markAdapted, updateBandwidth };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/player/PlayerState.svelte.ts src/lib/components/player/networkMonitor.ts
git commit -m "player: PlayerState rune store + network monitor"
```

---

## Task 5 — Menu components + ModePill

**Files:**
- Create: `src/lib/components/player/QualityMenu.svelte`
- Create: `src/lib/components/player/AudioMenu.svelte`
- Create: `src/lib/components/player/SubtitleMenu.svelte`
- Create: `src/lib/components/player/ModePill.svelte`

These are small Svelte 5 components that read from `PlayerState` and emit events. The implementer should read the existing `Player.svelte` (lines ~1740-1850) for the HTML structure and CSS classes used in the current quality/audio/subtitle menus, and replicate the styling in the new components. The new components receive `state: PlayerState` as a prop and read from it reactively.

**The implementer should create these using the svelte-file-editor skill** for proper Svelte 5 validation, or at minimum use `$props()` / `$derived` runes and not the legacy `export let` syntax.

Full code for each menu is too large to include in the plan. Instead, the implementer should:

1. Read `Player.svelte` lines 1740-1850 for the quality menu HTML/CSS.
2. Extract into `QualityMenu.svelte` — receives `state`, `levels`, `onSelect: (index: number) => void`.
3. Read `Player.svelte` lines 1850-1900 for the audio menu.
4. Extract into `AudioMenu.svelte` — receives `state`, `onSelect: (id: number) => void`.
5. Read `Player.svelte` lines 1900-1970 for the subtitle menu.
6. Extract into `SubtitleMenu.svelte` — receives `state`, `onSelect: (id: number) => void`, `onBurnIn: (id: number) => void`.
7. Create `ModePill.svelte`:

```svelte
<script lang="ts">
	import type { PlaybackMode } from '$lib/adapters/playback';

	let { mode, isBurnIn = false }: { mode: PlaybackMode; isBurnIn?: boolean } = $props();

	const colors: Record<PlaybackMode, string> = {
		'direct-play': '#34d399',
		'remux': '#60a5fa',
		'direct-stream': '#2dd4bf',
		'transcode': '#fb923c',
	};

	const labels: Record<PlaybackMode, string> = {
		'direct-play': 'DIRECT',
		'remux': 'REMUX',
		'direct-stream': 'AUDIO-TX',
		'transcode': 'TRANSCODE',
	};

	const label = $derived(isBurnIn ? `${labels[mode]} · burn-in` : labels[mode]);
	const color = $derived(colors[mode]);
</script>

<span
	class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
	style="background: {color}20; color: {color}"
>
	{label}
</span>
```

- [ ] **Step 1: Create all 4 components**
- [ ] **Step 2: Commit**

```bash
git add src/lib/components/player/
git commit -m "player: QualityMenu, AudioMenu, SubtitleMenu, ModePill components"
```

---

## Task 6 — NexusPlayer.svelte

This is the main task. The implementer should:

1. Read the existing `Player.svelte` (2,299 lines) end-to-end to understand the control chrome, keyboard shortcuts, scrub bar, volume slider, fullscreen toggle, theater mode, and progress reporting.
2. Build `NexusPlayer.svelte` that receives a `PlaybackSession` prop (from Phase 2's contract), creates the right engine, attaches it to a `<video>` element, and wires up the PlayerState store.
3. The chrome (play/pause button, seek bar, volume, fullscreen) should be lifted from Player.svelte mostly textually — same HTML structure, same CSS classes.
4. Quality changes call `session.changeQuality(plan)` instead of building URLs.
5. Mode pill shows `session.mode`.
6. The `QualityMenu`, `AudioMenu`, `SubtitleMenu`, `ModePill` components render inside the controls overlay.

**The implementer should use the svelte-file-editor skill** for Svelte 5 validation.

**Props:**
```ts
interface NexusPlayerProps {
	session: PlaybackSession;
	title?: string;
	subtitle?: string;
	poster?: string;
	progress?: number;
	duration?: number;
	autoplay?: boolean;
	serviceId?: string;
	itemId?: string;
	inline?: boolean;
	onclose?: () => void;
	onqualitychange?: (plan: PlaybackPlan) => Promise<PlaybackSession>;
}
```

The `onqualitychange` callback is called when the user picks a quality; the parent page re-negotiates and passes a new session. The player detaches the old engine, attaches the new one, and resumes from `currentTime`.

This task is intentionally open-ended — the implementer has the engine interface, the state store, the menu components, and the old Player.svelte as a reference. Target: ~500-700 lines for NexusPlayer.svelte.

- [ ] **Step 1: Create `NexusPlayer.svelte`**
- [ ] **Step 2: Typecheck**: `pnpm check 2>&1 | grep "NexusPlayer" | head -5`
- [ ] **Step 3: Commit**

```bash
git add src/lib/components/player/NexusPlayer.svelte
git commit -m "player: NexusPlayer.svelte — engine-dispatched player shell"
```

---

## Task 7 — Cut over media detail page

**Files:**
- Modify: `src/routes/media/[type]/[id]/+page.svelte`
- Modify: `src/routes/media/[type]/[id]/+page.server.ts`

Replace the 3 Player call sites with NexusPlayer:

1. **Theater mode (line ~635):** Replace `<Player streamUrl={...} ...>` with a block that:
   - Calls `POST /api/play/negotiate` with `{ serviceId, itemId, plan: {}, caps: probeBrowserCaps() }`.
   - Stores the returned `PlaybackSession` in a `$state`.
   - Renders `<NexusPlayer session={session} ... />`.

2. **Audio inline (line ~830):** Same pattern for audio items.

3. **Video inline (line ~1721):** For Invidious videos, call negotiate with the video service's serviceId + the videoId as itemId.

Remove the old Player import. Add imports for `NexusPlayer` and `probeBrowserCaps`.

In `+page.server.ts`: remove `videoStreamUrl` and `videoFormats` server-side fetching (these are now handled client-side via the contract).

- [ ] **Step 1: Modify the page**
- [ ] **Step 2: Test in browser** (manual — play a movie, play a video, play audio)
- [ ] **Step 3: Commit**

```bash
git add src/routes/media/
git commit -m "media: cut over to NexusPlayer for all playback surfaces"
```

---

## Task 8 — Rewrite TrailerPlayer + delete Player.svelte

**Files:**
- Modify: `src/lib/components/TrailerPlayer.svelte`
- Delete: `src/lib/components/Player.svelte`
- Delete: `src/lib/components/QualityBadge.svelte` (if unused after Player deletion)

- [ ] **Step 1: Rewrite TrailerPlayer as thin wrapper**

TrailerPlayer is 204 lines. Rewrite to ~50 lines: receive `src` + `audioSrc` props, create a progressive engine, attach to a muted `<video>`, handle hover-to-unmute. No NexusPlayer shell needed — trailers don't need controls chrome.

- [ ] **Step 2: Delete Player.svelte**

Verify no remaining imports: `grep -r "Player.svelte" src/ --include="*.svelte" --include="*.ts"`

If zero hits, delete: `rm src/lib/components/Player.svelte`

- [ ] **Step 3: Delete QualityBadge.svelte if unused**

`grep -r "QualityBadge" src/ --include="*.svelte" --include="*.ts"` — if zero hits, delete.

- [ ] **Step 4: Commit**

```bash
git add -A src/lib/components/
git commit -m "player: rewrite TrailerPlayer, delete old Player.svelte (2,299 lines removed)"
```

---

## Task 9 — Exit criteria

- [ ] **Step 1: Run tests**: `pnpm test -- --run`
- [ ] **Step 2: Typecheck**: `pnpm check`
- [ ] **Step 3: Build**: `pnpm build`
- [ ] **Step 4: Verify Player.svelte is gone**: `grep -r "Player.svelte" src/` — zero hits
- [ ] **Step 5: Count lines**: `find src/lib/components/player -name "*.svelte" -o -name "*.ts" | xargs wc -l` — target ~900 total
- [ ] **Step 6: Marker commit**

```bash
git commit --allow-empty -m "phase-3 complete: NexusPlayer replaces Player.svelte"
```

---

## Phase 3 done when

- [x] `NexusPlayer.svelte` renders for Jellyfin movies, Invidious videos, and audio items.
- [x] Engine dispatched by `session.engine` field (hls.js / dash.js / native).
- [x] Quality changes call `POST /api/play/negotiate` and reload the engine.
- [x] Mode pill shows DIRECT / REMUX / AUDIO-TX / TRANSCODE.
- [x] Quality label shows actual resolution (Auto (1080p) / Manual 720p).
- [x] Subtitle menu: text tracks as side-loads, image tracks collapsed behind burn-in disclosure.
- [x] `Player.svelte` deleted (2,299 lines removed).
- [x] `TrailerPlayer.svelte` rewritten as ~50-line thin wrapper.
- [x] All tests pass, build succeeds.
