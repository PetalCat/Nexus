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

			// Baseline config — adapter-neutral. Any server-specific tuning
			// (Plex's lazy-segment retry counts, etc.) arrives via
			// `session.hlsConfig`, applied below. Keeping the base config
			// free of adapter quirks means Jellyfin, Invidious, and
			// direct-file HLS all use hls.js's well-tested defaults.
			const baseConfig = {
				maxBufferLength: 60,
				maxMaxBufferLength: 120,
				startLevel: -1,
				abrEwmaDefaultEstimate: 50_000_000,
				enableWorker: true,
				lowLatencyMode: false,
				debug: false,
			};
			hls = new Hls({
				...baseConfig,
				...(session.hlsConfig ?? {}),
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

			// Only fatal errors surface to the app. Transient networkError
			// events (Plex-style 404 on not-yet-generated segments, 400 on
			// cold-start manifests) get retried by hls.js and shouldn't
			// trigger the adaptive-downgrade stall path — doing so tears
			// down the working session and asks for a NEW transcode, which
			// Plex refuses with 400 because the prior session is still
			// active. FRAG_LOAD_EMERGENCY_ABORTED below still counts as a
			// stall since it fires only after all retries are exhausted.
			hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; type: string }) => {
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
