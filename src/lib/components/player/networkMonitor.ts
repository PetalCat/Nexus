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
