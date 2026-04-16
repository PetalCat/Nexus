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
