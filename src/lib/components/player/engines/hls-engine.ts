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
				// Plex's transcoder occasionally 400s the first /start.m3u8
				// while its metadata probe races with session creation — the
				// retry succeeds every time. hls.js defaults to maxRetry=1 on
				// manifest/level loads; bump so these transient cold-starts
				// don't leave the player hung at readyState=0.
				manifestLoadingMaxRetry: 4,
				manifestLoadingRetryDelay: 800,
				levelLoadingMaxRetry: 4,
				levelLoadingRetryDelay: 800,
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
