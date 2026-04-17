/**
 * Browser↔Nexus bandwidth estimator.
 *
 * Fetches a fixed-size sample from `/api/internal/speed-sample`, measures
 * wall-clock, and stores the result in localStorage. The player's playback
 * negotiation reads this estimate and caps Jellyfin's `MaxStreamingBitrate`
 * so the first segment actually fits the user's link on their first ever
 * play — no 12 Mbps stream over a 5 Mbps pipe.
 *
 * Re-probe cadence:
 * - On session start if no estimate exists or it's > 24 h old.
 * - On demand when the player reports repeated stalls (reportStall).
 */

import { browser } from '$app/environment';

const STORAGE_KEY = 'nexus:bandwidth-estimate';
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const SAMPLE_BYTES = 1024 * 1024; // must match the server endpoint
const MIN_SAMPLE_MS = 50; // avoid absurd rates from sub-50ms runs (hit cache, etc.)

interface Estimate {
	bps: number;
	updatedAt: number;
}

let inflight: Promise<number | undefined> | null = null;

export function getEstimatedBandwidth(): number | undefined {
	if (!browser) return undefined;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return undefined;
		const parsed = JSON.parse(raw) as Estimate;
		if (typeof parsed.bps !== 'number' || parsed.bps <= 0) return undefined;
		return parsed.bps;
	} catch {
		return undefined;
	}
}

function estimateAgeMs(): number {
	if (!browser) return Infinity;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return Infinity;
		const parsed = JSON.parse(raw) as Estimate;
		return Date.now() - parsed.updatedAt;
	} catch {
		return Infinity;
	}
}

/**
 * Fire the probe once in the background. No-op if we've probed recently
 * (within 24 h) unless `{ force: true }` is passed.
 */
export function probeBandwidthIfStale(opts: { force?: boolean } = {}): Promise<number | undefined> {
	if (!browser) return Promise.resolve(undefined);
	if (!opts.force && estimateAgeMs() < STALE_AFTER_MS) {
		return Promise.resolve(getEstimatedBandwidth());
	}
	if (inflight) return inflight;

	inflight = (async () => {
		try {
			const start = performance.now();
			const res = await fetch('/api/internal/speed-sample', {
				cache: 'no-store',
				credentials: 'include',
			});
			if (!res.ok || !res.body) return undefined;
			// Drain the stream. The server sends exactly SAMPLE_BYTES so we
			// trust that; measuring actual consumed bytes in case of an
			// upstream cut-off.
			const reader = res.body.getReader();
			let received = 0;
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value) received += value.byteLength;
			}
			const elapsedMs = performance.now() - start;
			if (elapsedMs < MIN_SAMPLE_MS || received < SAMPLE_BYTES / 2) {
				// Too fast to be real or too little data — don't persist a
				// garbage measurement.
				return undefined;
			}
			const bps = Math.floor((received * 8 * 1000) / elapsedMs);
			const record: Estimate = { bps, updatedAt: Date.now() };
			try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* quota */ }
			return bps;
		} catch {
			return undefined;
		} finally {
			inflight = null;
		}
	})();

	return inflight;
}

/**
 * Called by the player when it sees repeated stalls — force a fresh probe
 * so the next negotiate uses current conditions instead of a stale estimate.
 */
export function reportStall(): void {
	// Invalidate the stored estimate so the next probeBandwidthIfStale() hit
	// forces a refresh. Don't fire the probe here — let the next natural
	// negotiate trigger it.
	if (!browser) return;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Estimate;
		// Age it out by setting updatedAt into the past.
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ bps: parsed.bps, updatedAt: Date.now() - STALE_AFTER_MS - 1 })
		);
	} catch {
		/* ignore */
	}
}

/**
 * Convert a measured bandwidth into a conservative streaming bitrate cap.
 * Leaves 20 % headroom so transient variance doesn't stall the player.
 */
export function recommendedMaxBitrate(bps: number): number {
	return Math.max(500_000, Math.floor(bps * 0.8));
}
