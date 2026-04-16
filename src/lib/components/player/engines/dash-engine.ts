import type { PlayerEngine, Level, StallMetric } from '../PlayerEngine';
import type { PlaybackSession } from '$lib/adapters/playback';

export async function createDashEngine(): Promise<PlayerEngine> {
	const dashjs = await import('dashjs');

	let player: dashjs.MediaPlayerClass | null = null;
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
				const idx = (player as any).getQualityFor('video') as number;
				activeLevelIndex = idx;
				const bitrateList = ((player as any).getBitrateInfoListFor('video') ?? []) as { qualityIndex: number; height: number; bitrate: number }[];
				levels = bitrateList.map((b, i: number) => ({
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
				(player as any).setQualityFor('video', index);
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
