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
