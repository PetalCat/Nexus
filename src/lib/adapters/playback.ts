import type { ServiceConfig, UserCredential } from './types';

// ── Plan: what the client wants ────────────────────────────────────────

export interface PlaybackPlan {
	targetHeight?: number;
	maxBitrate?: number;
	audioTrackHint?: number;
	subtitleTrackHint?: number;
	burnSubIndex?: number;
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

/**
 * Which media server produced this session. The proxy and the HLS engine
 * both need this to apply server-specific quirks (Plex's lazy segments,
 * live-style manifests, non-ladder resolution rejections, etc.) without
 * leaking those quirks into shared code paths.
 *
 * `generic` is for everything else (Invidious, direct file URLs) where no
 * server-specific behavior is needed.
 */
export type PlaybackKind = 'plex' | 'jellyfin' | 'generic';

/**
 * Subset of hls.js config fields an adapter may override. Deliberately
 * narrow — we only expose what adapters actually need to tune. Add more
 * fields here as specific needs arise; don't widen to `Partial<HlsConfig>`
 * wholesale, since that leaks hls.js internals into the adapter contract.
 */
export interface AdapterHlsConfig {
	fragLoadingMaxRetry?: number;
	fragLoadingRetryDelay?: number;
	manifestLoadingMaxRetry?: number;
	manifestLoadingRetryDelay?: number;
	levelLoadingMaxRetry?: number;
	levelLoadingRetryDelay?: number;
}

export interface TrackInfo {
	id: number;
	name: string;
	lang: string;
	codec?: string;
	isExternal?: boolean;
	/** Side-loadable VTT/SRT URL. Player injects this as a <track> element.
	 *  If absent, the track is assumed to come from the HLS/DASH manifest. */
	url?: string;
}

/** Pre-computed quality level. Adapters may supply this when they can derive
 *  levels from metadata (e.g. parsing a DASH manifest); engines may also
 *  report levels at runtime. The player uses adapter-supplied levels first
 *  so the quality menu is visible before the engine finishes loading. */
export interface SessionLevel {
	index: number;
	height: number;
	bitrate: number;
}

export interface PlaybackSession {
	engine: PlaybackEngine;
	/** Which adapter produced this session — used by the HLS engine and the
	 *  Rust stream-proxy to apply server-specific workarounds. Defaults to
	 *  `'generic'` when the producer doesn't set it. */
	kind?: PlaybackKind;
	/** Adapter-supplied hls.js config overrides. Merged on top of the
	 *  engine's defaults. Used e.g. by the Plex adapter to crank fragment
	 *  retries for Plex's lazily-generated segments. */
	hlsConfig?: AdapterHlsConfig;
	url: string;
	mime?: string;
	mode: PlaybackMode;
	playSessionId?: string;
	mediaSourceId?: string;

	audioTracks: TrackInfo[];
	subtitleTracks: TrackInfo[];
	burnableSubtitleTracks: TrackInfo[];
	activeLevel?: { height: number; bitrate: number };
	levels?: SessionLevel[];
	/** Source resolution height (pixels). Used by the quality menu to hide
	 *  preset options above the source — transcoding up from 720p to 1440p
	 *  just wastes CPU. Absent if the adapter can't determine it. */
	sourceHeight?: number;

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
