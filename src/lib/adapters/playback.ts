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
