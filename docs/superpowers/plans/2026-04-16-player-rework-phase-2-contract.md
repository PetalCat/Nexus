# Player Rework — Phase 2 — Playback Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the `negotiatePlayback` contract on the adapter interface, implement it for Jellyfin (via `POST /Items/{id}/PlaybackInfo` with a DeviceProfile) and Invidious (via format/itag selection), expose it through a new `POST /api/play/negotiate` endpoint, and add Jellyfin session lifecycle management (Playing/Progress/Stopped).

**Architecture:** The adapter's `negotiatePlayback(item, plan, caps)` is the single entry point for "how do I play this thing." Jellyfin's implementation submits a browser-capabilities-derived DeviceProfile to Jellyfin's PlaybackInfo endpoint and uses the server-returned `TranscodingUrl` verbatim — Nexus never hand-builds master.m3u8 query strings. Invidious's implementation selects the best itag from the video's format list. Both return a `PlaybackSession` that the client (Phase 3's NexusPlayer) or the existing Player can consume. Session lifecycle (start/progress/stop) is Jellyfin-specific and ensures transcode jobs are cleaned up.

**Tech Stack:** TypeScript (SvelteKit server), Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-04-15-player-streaming-rework-design.md`, Sections 2 (contract), 5 (adaptive auto), 6 (subtitles), plus the DeviceProfile appendix.

---

## File structure

**New files:**

| Path | Responsibility |
|---|---|
| `src/lib/adapters/playback.ts` | Playback contract types: `PlaybackPlan`, `PlaybackSession`, `BrowserCaps`, `PlaybackMode`, `PlaybackEngine`, `TrackInfo` |
| `src/lib/adapters/jellyfin-profile.ts` | `buildDeviceProfile(caps, plan)` — constructs the Jellyfin DeviceProfile JSON from BrowserCaps |
| `src/lib/adapters/jellyfin-playback.ts` | `jellyfinNegotiatePlayback(config, userCred, item, plan, caps)` — calls PlaybackInfo, maps response to PlaybackSession |
| `src/lib/adapters/jellyfin-telemetry.ts` | `reportPlaybackStart/Progress/Stopped(config, userCred, session)` — Jellyfin session lifecycle |
| `src/lib/adapters/invidious-playback.ts` | `invidiousNegotiatePlayback(config, userCred, item, plan, caps)` — itag selection → PlaybackSession |
| `src/lib/server/playback.ts` | `negotiate(serviceId, itemId, plan, caps, user)` — server-side orchestrator that looks up the adapter and calls its negotiatePlayback, then creates a Rust proxy session |
| `src/routes/api/play/negotiate/+server.ts` | `POST /api/play/negotiate` — accepts `{ serviceId, itemId, plan, caps }` JSON, returns PlaybackSession JSON |
| `src/lib/adapters/__tests__/jellyfin-profile.test.ts` | Vitest tests for DeviceProfile builder |
| `src/lib/adapters/__tests__/jellyfin-playback.test.ts` | Vitest tests for PlaybackInfo → PlaybackSession mapping |
| `src/lib/adapters/__tests__/invidious-playback.test.ts` | Vitest tests for itag selection |

**Modified files:**

| Path | Change |
|---|---|
| `src/lib/adapters/contract.ts` | Add `negotiatePlayback?` method to `NexusAdapter` interface |
| `src/lib/adapters/jellyfin.ts` | Wire `negotiatePlayback` to `jellyfinNegotiatePlayback` |
| `src/lib/adapters/invidious.ts` | Wire `negotiatePlayback` to `invidiousNegotiatePlayback` |

**NOT modified (Phase 2 is additive):**

- `Player.svelte` — unchanged; Phase 3 cuts it over.
- `/api/stream/[serviceId]/[...path]/+server.ts` — unchanged; Phase 1's delegation block stays.
- Rust `stream-proxy/` — unchanged; Phase 1's session/manifest-rewrite handles everything Phase 2 needs.

---

## Task 1 — Playback contract types

**Files:**
- Create: `src/lib/adapters/playback.ts`
- Modify: `src/lib/adapters/contract.ts`

- [ ] **Step 1: Create `src/lib/adapters/playback.ts`**

```ts
import type { ServiceConfig, UserCredential, UnifiedMedia } from './types';

// ── Plan: what the client wants ────────────────────────────────────────

export interface PlaybackPlan {
	targetHeight?: number;
	maxBitrate?: number;
	audioTrackHint?: number;
	subtitleTrackHint?: number;
	/** Explicit user opt-in to image-subtitle burn-in (forces transcode). */
	burnSubIndex?: number;
	/** Resume position in seconds. Jellyfin converts to ticks. */
	startPositionSeconds?: number;
}

// ── Capabilities: what the browser can decode ──────────────────────────

export interface BrowserCaps {
	videoCodecs: string[];
	audioCodecs: string[];
	containers: string[];
	maxHeight?: number;
}

// ── Session: what the adapter decided ──────────────────────────────────

export type PlaybackMode = 'direct-play' | 'remux' | 'direct-stream' | 'transcode';
export type PlaybackEngine = 'hls' | 'dash' | 'progressive';

export interface TrackInfo {
	id: number;
	name: string;
	lang: string;
	codec?: string;
	isExternal?: boolean;
}

export interface PlaybackSession {
	engine: PlaybackEngine;
	url: string;
	mime?: string;
	mode: PlaybackMode;
	playSessionId?: string;
	mediaSourceId?: string;

	audioTracks: TrackInfo[];
	subtitleTracks: TrackInfo[];
	burnableSubtitleTracks: TrackInfo[];
	activeLevel?: { height: number; bitrate: number };

	changeQuality?(plan: PlaybackPlan): Promise<PlaybackSession>;
	close?(): Promise<void>;
}

// ── Adapter method signature ───────────────────────────────────────────

export interface NegotiatePlaybackFn {
	(
		config: ServiceConfig,
		userCred: UserCredential | undefined,
		item: { id: string; type: string; title?: string },
		plan: PlaybackPlan,
		caps: BrowserCaps
	): Promise<PlaybackSession>;
}
```

- [ ] **Step 2: Add `negotiatePlayback` to `NexusAdapter` interface in `contract.ts`**

At the bottom of `src/lib/adapters/contract.ts`, inside the `NexusAdapter` interface, before the closing `}`, add:

```ts
	// ── Playback contract (Phase 2) ────────────────────────────────────────
	/** Negotiate playback for an item. Returns a PlaybackSession the client
	 *  can hand to an engine (hls.js, dash.js, native <video>). */
	negotiatePlayback?(
		config: ServiceConfig,
		userCred: UserCredential | undefined,
		item: { id: string; type: string; title?: string },
		plan: import('./playback').PlaybackPlan,
		caps: import('./playback').BrowserCaps
	): Promise<import('./playback').PlaybackSession>;
```

Using inline `import()` types to avoid adding an import at the top of contract.ts (keeps the existing import surface unchanged for adapters that don't implement playback).

- [ ] **Step 3: Typecheck**

Run: `pnpm check 2>&1 | grep -E "playback.ts|contract.ts" | head -10`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/adapters/playback.ts src/lib/adapters/contract.ts
git commit -m "adapters: add playback contract types (PlaybackPlan, PlaybackSession, BrowserCaps)"
```

---

## Task 2 — Jellyfin DeviceProfile builder

**Files:**
- Create: `src/lib/adapters/jellyfin-profile.ts`
- Create: `src/lib/adapters/__tests__/jellyfin-profile.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// src/lib/adapters/__tests__/jellyfin-profile.test.ts
import { describe, it, expect } from 'vitest';
import { buildDeviceProfile } from '../jellyfin-profile';
import type { BrowserCaps, PlaybackPlan } from '../playback';

const defaultCaps: BrowserCaps = {
	videoCodecs: ['avc1.640028', 'hev1.1.6.L93.B0'],
	audioCodecs: ['mp4a.40.2', 'opus'],
	containers: ['mp4', 'webm'],
};

describe('buildDeviceProfile', () => {
	it('returns a profile with DirectPlayProfiles and TranscodingProfiles', () => {
		const profile = buildDeviceProfile(defaultCaps, {});
		expect(profile.Name).toBe('Nexus MSE Browser');
		expect(profile.DirectPlayProfiles).toBeDefined();
		expect(profile.DirectPlayProfiles.length).toBeGreaterThan(0);
		expect(profile.TranscodingProfiles).toBeDefined();
		expect(profile.TranscodingProfiles.length).toBeGreaterThan(0);
	});

	it('includes HLS hack DirectPlayProfile', () => {
		const profile = buildDeviceProfile(defaultCaps, {});
		const hlsProfile = profile.DirectPlayProfiles.find(
			(p: any) => p.Container === 'hls'
		);
		expect(hlsProfile).toBeDefined();
		expect(hlsProfile.Type).toBe('Video');
	});

	it('does NOT include MKV in DirectPlayProfiles', () => {
		const profile = buildDeviceProfile(defaultCaps, {});
		const mkvProfile = profile.DirectPlayProfiles.find(
			(p: any) => p.Container?.includes('mkv')
		);
		expect(mkvProfile).toBeUndefined();
	});

	it('sets MaxStreamingBitrate from plan', () => {
		const plan: PlaybackPlan = { maxBitrate: 4_000_000 };
		const profile = buildDeviceProfile(defaultCaps, plan);
		expect(profile.MaxStreamingBitrate).toBe(4_000_000);
	});

	it('uses AAC for HLS transcoding audio (no Opus in fMP4)', () => {
		const profile = buildDeviceProfile(defaultCaps, {});
		const hlsTx = profile.TranscodingProfiles.find(
			(p: any) => p.Protocol === 'hls' && p.Container === 'mp4'
		);
		expect(hlsTx).toBeDefined();
		expect(hlsTx.AudioCodec).toContain('aac');
		expect(hlsTx.AudioCodec).not.toContain('opus');
	});
});
```

- [ ] **Step 2: Run the test — expect failure (module not found)**

Run: `pnpm test -- --run src/lib/adapters/__tests__/jellyfin-profile.test.ts 2>&1 | tail -10`
Expected: `Cannot find module '../jellyfin-profile'` or similar.

- [ ] **Step 3: Write `src/lib/adapters/jellyfin-profile.ts`**

```ts
import type { BrowserCaps, PlaybackPlan } from './playback';

/**
 * Build a Jellyfin 10.11 DeviceProfile from browser capabilities and a
 * playback plan. The profile tells Jellyfin what the client can decode so
 * Jellyfin picks the right mode (direct-play / remux / direct-stream /
 * transcode).
 *
 * Shape follows Jellyfin Web's `scripts/browserDeviceProfile.js` pattern,
 * tightened for MSE browsers. See the design spec appendix for rationale.
 */
export function buildDeviceProfile(caps: BrowserCaps, plan: PlaybackPlan) {
	const maxBitrate = plan.maxBitrate ?? 120_000_000;

	// Video codecs the browser reported via MSE.isTypeSupported
	const canH264 = caps.videoCodecs.some((c) => c.startsWith('avc1'));
	const canHEVC = caps.videoCodecs.some((c) => c.startsWith('hev1') || c.startsWith('hvc1'));
	const canAV1 = caps.videoCodecs.some((c) => c.startsWith('av01'));
	const canVP9 = caps.videoCodecs.some((c) => c.startsWith('vp09') || c === 'vp9');
	const canVP8 = caps.videoCodecs.some((c) => c === 'vp8');

	const videoCodecList = [
		canH264 && 'h264',
		canHEVC && 'hevc',
		canAV1 && 'av1',
	].filter(Boolean).join(',') || 'h264';

	const webmVideoCodecList = [
		canVP8 && 'vp8',
		canVP9 && 'vp9',
		canAV1 && 'av1',
	].filter(Boolean).join(',');

	// Direct-play: only containers the browser handles natively
	const directPlayProfiles: any[] = [
		{
			Container: 'mp4,m4v',
			Type: 'Video',
			VideoCodec: videoCodecList,
			AudioCodec: 'aac,mp3,ac3,eac3,opus',
		},
	];
	if (webmVideoCodecList) {
		directPlayProfiles.push({
			Container: 'webm',
			Type: 'Video',
			VideoCodec: webmVideoCodecList,
			AudioCodec: 'vorbis,opus',
		});
	}
	// HLS "hack" — Jellyfin Web pattern. The API can't express "HLS protocol
	// with MP4/TS sub-container" in a capability filter, so we advertise 'hls'
	// as a container and rely on the TranscodingProfiles for the real output.
	directPlayProfiles.push({
		Container: 'hls',
		Type: 'Video',
		VideoCodec: videoCodecList,
		AudioCodec: 'aac,mp3',
	});

	// Transcoding: fMP4-HLS (preferred) + TS-HLS (fallback)
	const transcodingProfiles: any[] = [
		{
			Container: 'mp4',
			Type: 'Video',
			Context: 'Streaming',
			Protocol: 'hls',
			VideoCodec: videoCodecList,
			AudioCodec: 'aac,mp3',
			MaxAudioChannels: '2',
			MinSegments: 1,
			BreakOnNonKeyFrames: true,
		},
		{
			Container: 'ts',
			Type: 'Video',
			Context: 'Streaming',
			Protocol: 'hls',
			VideoCodec: canH264 ? 'h264' : videoCodecList,
			AudioCodec: 'aac,mp3',
			MaxAudioChannels: '2',
			MinSegments: 1,
			BreakOnNonKeyFrames: true,
		},
	];

	return {
		Name: 'Nexus MSE Browser',
		MaxStreamingBitrate: maxBitrate,
		MaxStaticBitrate: 100_000_000,
		DirectPlayProfiles: directPlayProfiles,
		TranscodingProfiles: transcodingProfiles,
		ContainerProfiles: [],
		CodecProfiles: [],
		SubtitleProfiles: [],
	};
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test -- --run src/lib/adapters/__tests__/jellyfin-profile.test.ts 2>&1 | tail -15`
Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapters/jellyfin-profile.ts src/lib/adapters/__tests__/jellyfin-profile.test.ts
git commit -m "jellyfin: DeviceProfile builder from BrowserCaps (Phase 2)"
```

---

## Task 3 — Jellyfin negotiatePlayback

**Files:**
- Create: `src/lib/adapters/jellyfin-playback.ts`
- Create: `src/lib/adapters/__tests__/jellyfin-playback.test.ts`

- [ ] **Step 1: Write test file**

```ts
// src/lib/adapters/__tests__/jellyfin-playback.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
	mapPlaybackInfoToSession,
	derivePlaybackMode,
	filterTextSubtitles,
	filterImageSubtitles,
} from '../jellyfin-playback';

describe('derivePlaybackMode', () => {
	it('returns direct-play when TranscodingUrl is absent and SupportsDirectPlay', () => {
		expect(derivePlaybackMode({ SupportsDirectPlay: true, SupportsDirectStream: true })).toBe('direct-play');
	});
	it('returns direct-stream when TranscodingUrl is absent and SupportsDirectStream but not DirectPlay', () => {
		expect(derivePlaybackMode({ SupportsDirectPlay: false, SupportsDirectStream: true })).toBe('direct-stream');
	});
	it('returns transcode when TranscodingUrl is present', () => {
		expect(derivePlaybackMode({ SupportsDirectPlay: false, SupportsDirectStream: false, TranscodingUrl: '/Videos/abc/master.m3u8?x=1' })).toBe('transcode');
	});
});

describe('filterTextSubtitles', () => {
	const streams = [
		{ Index: 1, Type: 'Subtitle', Codec: 'srt', DisplayTitle: 'English', Language: 'eng', IsExternal: true },
		{ Index: 2, Type: 'Subtitle', Codec: 'ass', DisplayTitle: 'Japanese', Language: 'jpn', IsExternal: false },
		{ Index: 3, Type: 'Subtitle', Codec: 'pgssub', DisplayTitle: 'French PGS', Language: 'fre', IsExternal: false },
		{ Index: 4, Type: 'Audio', Codec: 'aac', DisplayTitle: 'English', Language: 'eng', IsExternal: false },
	];

	it('returns only text-based subtitle tracks', () => {
		const result = filterTextSubtitles(streams);
		expect(result).toHaveLength(2);
		expect(result[0].name).toBe('English');
		expect(result[1].name).toBe('Japanese');
	});
});

describe('filterImageSubtitles', () => {
	const streams = [
		{ Index: 1, Type: 'Subtitle', Codec: 'srt', DisplayTitle: 'English', Language: 'eng' },
		{ Index: 3, Type: 'Subtitle', Codec: 'pgssub', DisplayTitle: 'French PGS', Language: 'fre' },
		{ Index: 5, Type: 'Subtitle', Codec: 'dvdsub', DisplayTitle: 'German DVD', Language: 'deu' },
	];

	it('returns only image-based subtitle tracks', () => {
		const result = filterImageSubtitles(streams);
		expect(result).toHaveLength(2);
		expect(result[0].codec).toBe('pgssub');
		expect(result[1].codec).toBe('dvdsub');
	});
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `pnpm test -- --run src/lib/adapters/__tests__/jellyfin-playback.test.ts 2>&1 | tail -10`

- [ ] **Step 3: Create `src/lib/adapters/jellyfin-playback.ts`**

```ts
import type { ServiceConfig, UserCredential } from './types';
import type { PlaybackPlan, PlaybackSession, BrowserCaps, PlaybackMode, TrackInfo } from './playback';
import { buildDeviceProfile } from './jellyfin-profile';
import { createStreamSession } from '$lib/server/stream-proxy';

const IMAGE_SUB_CODECS = new Set(['pgssub', 'pgs', 'dvbsub', 'dvdsub', 'vobsub', 'hdmv_pgs_subtitle']);

// ── Exported helpers (tested independently) ────────────────────────────

export function derivePlaybackMode(source: {
	SupportsDirectPlay?: boolean;
	SupportsDirectStream?: boolean;
	TranscodingUrl?: string | null;
}): PlaybackMode {
	if (source.TranscodingUrl) return 'transcode';
	if (source.SupportsDirectPlay) return 'direct-play';
	if (source.SupportsDirectStream) return 'direct-stream';
	return 'transcode';
}

export function filterTextSubtitles(streams: any[]): TrackInfo[] {
	return streams
		.filter((s) => s.Type === 'Subtitle' && !IMAGE_SUB_CODECS.has(String(s.Codec ?? '').toLowerCase()))
		.map((s) => ({
			id: s.Index as number,
			name: (s.DisplayTitle ?? s.DisplayLanguage ?? s.Language ?? `Sub ${s.Index}`) as string,
			lang: (s.Language ?? '') as string,
			codec: s.Codec as string | undefined,
			isExternal: (s.IsExternal ?? false) as boolean,
		}));
}

export function filterImageSubtitles(streams: any[]): TrackInfo[] {
	return streams
		.filter((s) => s.Type === 'Subtitle' && IMAGE_SUB_CODECS.has(String(s.Codec ?? '').toLowerCase()))
		.map((s) => ({
			id: s.Index as number,
			name: (s.DisplayTitle ?? s.DisplayLanguage ?? s.Language ?? `Sub ${s.Index}`) as string,
			lang: (s.Language ?? '') as string,
			codec: s.Codec as string | undefined,
			isExternal: (s.IsExternal ?? false) as boolean,
		}));
}

export function filterAudioTracks(streams: any[]): TrackInfo[] {
	return streams
		.filter((s) => s.Type === 'Audio')
		.map((s) => ({
			id: s.Index as number,
			name: (s.DisplayTitle ?? s.DisplayLanguage ?? s.Language ?? `Audio ${s.Index}`) as string,
			lang: (s.Language ?? '') as string,
			codec: s.Codec as string | undefined,
		}));
}

export function mapPlaybackInfoToSession(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	info: any,
	plan: PlaybackPlan,
	caps: BrowserCaps
): PlaybackSession {
	const source = info.MediaSources?.[0];
	if (!source) throw new Error('No media sources returned from PlaybackInfo');

	const mode = derivePlaybackMode(source);
	const streams: any[] = source.MediaStreams ?? [];
	const playSessionId = info.PlaySessionId as string | undefined;

	// Jellyfin returns TranscodingUrl as a relative path starting with /videos/...
	// For direct-play, we build the direct stream URL ourselves.
	let streamUrl: string;
	if (source.TranscodingUrl) {
		streamUrl = `${config.url}${source.TranscodingUrl}`;
	} else {
		const itemId = source.Id ?? source.ItemId ?? '';
		streamUrl = `${config.url}/Videos/${itemId}/stream?static=true&MediaSourceId=${itemId}`;
		if (userCred?.externalUserId) {
			streamUrl += `&UserId=${userCred.externalUserId}`;
		}
	}

	const session: PlaybackSession = {
		engine: source.TranscodingUrl ? 'hls' : 'progressive',
		url: streamUrl,
		mode,
		playSessionId,
		mediaSourceId: source.Id,
		audioTracks: filterAudioTracks(streams),
		subtitleTracks: filterTextSubtitles(streams),
		burnableSubtitleTracks: filterImageSubtitles(streams),
	};

	return session;
}

// ── Main entry point ───────────────────────────────────────────────────

export async function jellyfinNegotiatePlayback(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	item: { id: string; type: string; title?: string },
	plan: PlaybackPlan,
	caps: BrowserCaps
): Promise<PlaybackSession> {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	const userId = userCred?.externalUserId ?? '';

	const profile = buildDeviceProfile(caps, plan);

	const body: Record<string, unknown> = {
		UserId: userId,
		DeviceProfile: profile,
		EnableDirectPlay: true,
		EnableDirectStream: true,
		EnableTranscoding: true,
		AllowVideoStreamCopy: true,
		AllowAudioStreamCopy: true,
		AutoOpenLiveStream: true,
	};
	if (plan.maxBitrate) body.MaxStreamingBitrate = plan.maxBitrate;
	if (plan.startPositionSeconds) {
		body.StartTimeTicks = Math.round(plan.startPositionSeconds * 10_000_000);
	}
	if (plan.burnSubIndex !== undefined) {
		body.SubtitleStreamIndex = plan.burnSubIndex;
	}

	const res = await fetch(`${config.url}/Items/${item.id}/PlaybackInfo`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-playback", Version="1.0.0", Token="${token}"`,
			'X-Emby-Token': token,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(10_000),
	});

	if (!res.ok) {
		throw new Error(`Jellyfin PlaybackInfo failed: ${res.status}`);
	}

	const info = await res.json();
	const session = mapPlaybackInfoToSession(config, userCred, info, plan, caps);

	// Wrap the stream URL through the Rust proxy for ApiKey stripping + byte pipe
	const proxySession = await createStreamSession({
		upstreamUrl: session.url,
		authHeaders: {
			Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-playback", Version="1.0.0", Token="${token}"`,
			'X-Emby-Token': token,
		},
		isHls: session.engine === 'hls',
	});
	if (proxySession) {
		session.url = proxySession.streamUrl;
	}

	// Wire up changeQuality to re-negotiate
	session.changeQuality = async (newPlan: PlaybackPlan) => {
		return jellyfinNegotiatePlayback(config, userCred, item, { ...plan, ...newPlan }, caps);
	};

	// Wire up close to report playback stopped
	session.close = async () => {
		if (!session.playSessionId) return;
		try {
			await fetch(`${config.url}/Sessions/Playing/Stopped`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-playback", Version="1.0.0", Token="${token}"`,
					'X-Emby-Token': token,
				},
				body: JSON.stringify({ PlaySessionId: session.playSessionId }),
				signal: AbortSignal.timeout(5000),
			});
		} catch { /* best-effort */ }
	};

	return session;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test -- --run src/lib/adapters/__tests__/jellyfin-playback.test.ts 2>&1 | tail -15`
Expected: all tests passing (the tests use the exported helper functions, not the async `jellyfinNegotiatePlayback` which requires a live Jellyfin).

- [ ] **Step 5: Commit**

```bash
git add src/lib/adapters/jellyfin-playback.ts src/lib/adapters/__tests__/jellyfin-playback.test.ts
git commit -m "jellyfin: negotiatePlayback via POST /Items/{id}/PlaybackInfo (Phase 2)"
```

---

## Task 4 — Jellyfin session telemetry

**Files:**
- Create: `src/lib/adapters/jellyfin-telemetry.ts`

- [ ] **Step 1: Create `src/lib/adapters/jellyfin-telemetry.ts`**

```ts
import type { ServiceConfig, UserCredential } from './types';
import type { PlaybackMode } from './playback';

function authHeaders(token: string) {
	return {
		'Content-Type': 'application/json',
		Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-playback", Version="1.0.0", Token="${token}"`,
		'X-Emby-Token': token,
	};
}

function playMethodFromMode(mode: PlaybackMode): string {
	switch (mode) {
		case 'direct-play': return 'DirectPlay';
		case 'remux': return 'DirectStream';
		case 'direct-stream': return 'DirectStream';
		case 'transcode': return 'Transcode';
	}
}

export async function reportPlaybackStart(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	params: {
		itemId: string;
		mediaSourceId: string;
		playSessionId: string;
		mode: PlaybackMode;
		positionTicks?: number;
	}
) {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	await fetch(`${config.url}/Sessions/Playing`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({
			ItemId: params.itemId,
			MediaSourceId: params.mediaSourceId,
			PlaySessionId: params.playSessionId,
			PlayMethod: playMethodFromMode(params.mode),
			PositionTicks: params.positionTicks ?? 0,
			CanSeek: true,
		}),
		signal: AbortSignal.timeout(5000),
	}).catch(() => {});
}

export async function reportPlaybackProgress(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	params: {
		itemId: string;
		mediaSourceId: string;
		playSessionId: string;
		mode: PlaybackMode;
		positionTicks: number;
		isPaused: boolean;
	}
) {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	await fetch(`${config.url}/Sessions/Playing/Progress`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({
			ItemId: params.itemId,
			MediaSourceId: params.mediaSourceId,
			PlaySessionId: params.playSessionId,
			PlayMethod: playMethodFromMode(params.mode),
			PositionTicks: params.positionTicks,
			IsPaused: params.isPaused,
			CanSeek: true,
		}),
		signal: AbortSignal.timeout(5000),
	}).catch(() => {});
}

export async function reportPlaybackStopped(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	params: {
		itemId: string;
		mediaSourceId: string;
		playSessionId: string;
		positionTicks: number;
	}
) {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	await fetch(`${config.url}/Sessions/Playing/Stopped`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({
			ItemId: params.itemId,
			MediaSourceId: params.mediaSourceId,
			PlaySessionId: params.playSessionId,
			PositionTicks: params.positionTicks,
		}),
		signal: AbortSignal.timeout(5000),
	}).catch(() => {});
}

export async function pingTranscodeSession(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	playSessionId: string
) {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	await fetch(`${config.url}/Sessions/Playing/Ping`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({ PlaySessionId: playSessionId }),
		signal: AbortSignal.timeout(3000),
	}).catch(() => {});
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm check 2>&1 | grep "jellyfin-telemetry" | head -5`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/adapters/jellyfin-telemetry.ts
git commit -m "jellyfin: session telemetry (Playing/Progress/Stopped/Ping)"
```

---

## Task 5 — Invidious negotiatePlayback

**Files:**
- Create: `src/lib/adapters/invidious-playback.ts`
- Create: `src/lib/adapters/__tests__/invidious-playback.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/lib/adapters/__tests__/invidious-playback.test.ts
import { describe, it, expect } from 'vitest';
import { pickBestFormat } from '../invidious-playback';
import type { BrowserCaps, PlaybackPlan } from '../playback';

const defaultCaps: BrowserCaps = {
	videoCodecs: ['avc1.640028'],
	audioCodecs: ['mp4a.40.2', 'opus'],
	containers: ['mp4', 'webm'],
};

const sampleFormats = [
	{ itag: '22', container: 'mp4', resolution: '720p', qualityLabel: '720p', encoding: 'h264', type: 'video/mp4', mimeType: 'video/mp4' },
	{ itag: '18', container: 'mp4', resolution: '360p', qualityLabel: '360p', encoding: 'h264', type: 'video/mp4', mimeType: 'video/mp4' },
	{ itag: '137', container: 'mp4', qualityLabel: '1080p', encoding: 'h264', type: 'video/mp4' },
];

describe('pickBestFormat', () => {
	it('picks highest resolution muxed format by default', () => {
		const result = pickBestFormat(sampleFormats, defaultCaps, {});
		expect(result?.itag).toBe('22'); // 720p muxed
	});

	it('respects targetHeight cap', () => {
		const plan: PlaybackPlan = { targetHeight: 360 };
		const result = pickBestFormat(sampleFormats, defaultCaps, plan);
		expect(result?.itag).toBe('18'); // 360p muxed
	});

	it('returns null for empty format list', () => {
		expect(pickBestFormat([], defaultCaps, {})).toBeNull();
	});
});
```

- [ ] **Step 2: Create `src/lib/adapters/invidious-playback.ts`**

```ts
import type { ServiceConfig, UserCredential } from './types';
import type { PlaybackPlan, PlaybackSession, BrowserCaps } from './playback';

const PREFERRED_MUXED_ITAGS = ['22', '18'];

export function pickBestFormat(
	formats: any[],
	caps: BrowserCaps,
	plan: PlaybackPlan
): { itag: string; mimeType?: string; qualityLabel?: string } | null {
	if (!formats.length) return null;

	// Filter to muxed formats (have both video + audio in one stream)
	const muxed = formats.filter(
		(f) => f.container === 'mp4' && (f.resolution || f.qualityLabel)
	);

	// Parse height from qualityLabel (e.g., "720p" → 720)
	const withHeight = muxed.map((f) => {
		const h = parseInt(String(f.qualityLabel ?? f.resolution ?? '0'));
		return { ...f, height: isNaN(h) ? 0 : h };
	});

	// Filter by targetHeight if set
	const heightCap = plan.targetHeight ?? Infinity;
	const eligible = withHeight.filter((f) => f.height <= heightCap);

	if (!eligible.length) {
		// Nothing under the cap — return lowest available
		const sorted = withHeight.sort((a, b) => a.height - b.height);
		return sorted[0] ?? null;
	}

	// Prefer highest-quality eligible format
	eligible.sort((a, b) => b.height - a.height);

	// Prefer known good itags within same height
	for (const itag of PREFERRED_MUXED_ITAGS) {
		const match = eligible.find((f) => f.itag === itag);
		if (match) return match;
	}

	return eligible[0] ?? null;
}

export async function invidiousNegotiatePlayback(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	item: { id: string; type: string; title?: string },
	plan: PlaybackPlan,
	caps: BrowserCaps
): Promise<PlaybackSession> {
	const videoId = item.id;
	const baseUrl = config.url.replace(/\/+$/, '');

	// Fetch available formats
	const res = await fetch(
		`${baseUrl}/api/v1/videos/${encodeURIComponent(videoId)}?fields=formatStreams,adaptiveFormats`,
		{ signal: AbortSignal.timeout(8000) }
	);
	if (!res.ok) throw new Error(`Invidious /api/v1/videos failed: ${res.status}`);
	const meta = await res.json();

	const allFormats = [...(meta.formatStreams ?? []), ...(meta.adaptiveFormats ?? [])];
	const picked = pickBestFormat(allFormats, caps, plan);
	const itag = picked?.itag ?? '18';

	// Fetch captions list
	let subtitleTracks: PlaybackSession['subtitleTracks'] = [];
	try {
		const capRes = await fetch(
			`${baseUrl}/api/v1/captions/${encodeURIComponent(videoId)}`,
			{ signal: AbortSignal.timeout(5000) }
		);
		if (capRes.ok) {
			const capData = await capRes.json();
			subtitleTracks = (capData.captions ?? []).map((c: any, i: number) => ({
				id: i,
				name: c.label ?? c.language_code ?? `Caption ${i}`,
				lang: c.language_code ?? '',
			}));
		}
	} catch { /* captions are optional */ }

	const session: PlaybackSession = {
		engine: 'progressive',
		url: `/api/video/stream/${encodeURIComponent(videoId)}?itag=${itag}`,
		mime: picked?.mimeType ?? 'video/mp4',
		mode: 'direct-play',
		audioTracks: [{ id: 0, name: 'Default', lang: '' }],
		subtitleTracks,
		burnableSubtitleTracks: [],
	};

	session.changeQuality = async (newPlan: PlaybackPlan) => {
		return invidiousNegotiatePlayback(config, userCred, item, { ...plan, ...newPlan }, caps);
	};

	return session;
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm test -- --run src/lib/adapters/__tests__/invidious-playback.test.ts 2>&1 | tail -10`
Expected: 3 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/adapters/invidious-playback.ts src/lib/adapters/__tests__/invidious-playback.test.ts
git commit -m "invidious: negotiatePlayback via itag selection (Phase 2)"
```

---

## Task 6 — Wire negotiatePlayback into adapters

**Files:**
- Modify: `src/lib/adapters/jellyfin.ts`
- Modify: `src/lib/adapters/invidious.ts`

- [ ] **Step 1: Add `negotiatePlayback` to the Jellyfin adapter**

In `src/lib/adapters/jellyfin.ts`, find the adapter object literal (the one with `ping`, `authenticateUser`, etc.) and add before the closing `}`:

```ts
	async negotiatePlayback(config, userCred, item, plan, caps) {
		const { jellyfinNegotiatePlayback } = await import('./jellyfin-playback');
		return jellyfinNegotiatePlayback(config, userCred, item, plan, caps);
	},
```

- [ ] **Step 2: Add `negotiatePlayback` to the Invidious adapter**

In `src/lib/adapters/invidious.ts`, find the `invidiousAdapter` object literal and add before the closing `}`:

```ts
	async negotiatePlayback(config, userCred, item, plan, caps) {
		const { invidiousNegotiatePlayback } = await import('./invidious-playback');
		return invidiousNegotiatePlayback(config, userCred, item, plan, caps);
	},
```

- [ ] **Step 3: Typecheck**

Run: `pnpm check 2>&1 | grep -E "jellyfin.ts|invidious.ts" | head -10`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/adapters/jellyfin.ts src/lib/adapters/invidious.ts
git commit -m "adapters: wire negotiatePlayback into jellyfin + invidious"
```

---

## Task 7 — Server-side playback orchestrator

**Files:**
- Create: `src/lib/server/playback.ts`

- [ ] **Step 1: Create `src/lib/server/playback.ts`**

```ts
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { PlaybackPlan, PlaybackSession, BrowserCaps } from '$lib/adapters/playback';

/**
 * Server-side playback negotiation orchestrator.
 *
 * Looks up the adapter for the given service, calls negotiatePlayback, and
 * returns the resulting PlaybackSession. The adapter handles all
 * service-specific logic (Jellyfin PlaybackInfo, Invidious itag selection)
 * and Rust proxy session creation internally.
 */
export async function negotiate(
	serviceId: string,
	itemId: string,
	plan: PlaybackPlan,
	caps: BrowserCaps,
	userId: string
): Promise<PlaybackSession> {
	const config = getServiceConfig(serviceId);
	if (!config) throw new Error(`Service not found: ${serviceId}`);

	const adapter = registry.get(config.type);
	if (!adapter?.negotiatePlayback) {
		throw new Error(`Adapter ${config.type} does not support playback negotiation`);
	}

	const userCred = getUserCredentialForService(userId, serviceId) ?? undefined;

	return adapter.negotiatePlayback(
		config,
		userCred,
		{ id: itemId, type: config.type },
		plan,
		caps
	);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm check 2>&1 | grep "playback.ts" | head -5`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/playback.ts
git commit -m "server: playback negotiation orchestrator"
```

---

## Task 8 — POST /api/play/negotiate endpoint

**Files:**
- Create: `src/routes/api/play/negotiate/+server.ts`

- [ ] **Step 1: Create the route**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { negotiate } from '$lib/server/playback';
import type { PlaybackPlan, BrowserCaps } from '$lib/adapters/playback';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: {
		serviceId: string;
		itemId: string;
		plan?: PlaybackPlan;
		caps?: BrowserCaps;
	};

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	if (!body.serviceId || !body.itemId) {
		return json({ error: 'Missing serviceId or itemId' }, { status: 400 });
	}

	const plan: PlaybackPlan = body.plan ?? {};
	const caps: BrowserCaps = body.caps ?? {
		videoCodecs: ['avc1.640028'],
		audioCodecs: ['mp4a.40.2'],
		containers: ['mp4', 'ts'],
	};

	try {
		const session = await negotiate(body.serviceId, body.itemId, plan, caps, locals.user.id);

		// Strip non-serializable functions before sending to client
		return json({
			engine: session.engine,
			url: session.url,
			mime: session.mime,
			mode: session.mode,
			playSessionId: session.playSessionId,
			mediaSourceId: session.mediaSourceId,
			audioTracks: session.audioTracks,
			subtitleTracks: session.subtitleTracks,
			burnableSubtitleTracks: session.burnableSubtitleTracks,
			activeLevel: session.activeLevel,
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[play/negotiate] error:', msg);
		return json({ error: msg }, { status: 500 });
	}
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm check 2>&1 | grep "api/play" | head -5`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/play/negotiate/+server.ts
git commit -m "api: POST /api/play/negotiate endpoint (Phase 2)"
```

---

## Task 9 — Run all tests + exit criteria

- [ ] **Step 1: Run the full Vitest suite**

Run: `pnpm test -- --run 2>&1 | tail -20`
Expected: all Phase 2 tests passing (at least 11 new: 5 profile + 3 playback + 3 invidious).

- [ ] **Step 2: Run the full typecheck**

Run: `pnpm check 2>&1 | tail -10`
Expected: zero errors (or only pre-existing ones in unrelated files).

- [ ] **Step 3: Verify the endpoint exists in the build**

Run: `pnpm build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 4: Commit marker**

```bash
git commit --allow-empty -m "phase-2 all tests passing, endpoint verified in build"
```

---

## Phase 2 done when

- [x] `PlaybackPlan`, `PlaybackSession`, `BrowserCaps`, `PlaybackMode`, `PlaybackEngine`, `TrackInfo` types defined in `src/lib/adapters/playback.ts`.
- [x] `negotiatePlayback` method added to `NexusAdapter` interface.
- [x] Jellyfin adapter implements it via `POST /Items/{id}/PlaybackInfo` + DeviceProfile.
- [x] Invidious adapter implements it via format/itag selection.
- [x] `POST /api/play/negotiate` endpoint accepts `{ serviceId, itemId, plan?, caps? }` and returns a serialized `PlaybackSession`.
- [x] Jellyfin session telemetry (Playing/Progress/Stopped/Ping) implemented.
- [x] DeviceProfile builder has 5 unit tests.
- [x] PlaybackInfo mapping has 5+ unit tests.
- [x] Invidious format picker has 3 unit tests.
- [x] No user-visible change (Phase 3 cuts the client over).

## What Phase 2 does NOT do

- Doesn't touch `Player.svelte` or any playback UI (Phase 3).
- Doesn't remove the legacy `/api/stream/[serviceId]/[...path]` route (Phase 3).
- Doesn't add the BrowserCaps client-side probe (`MediaSource.isTypeSupported`) — Phase 3 adds it in the player.
- Doesn't self-host fonts (Phase 4).
- Doesn't add the `DIRECT/REMUX/TRANSCODE` pill in the UI (Phase 3).
