/**
 * Playback session registry + reaper (Phase-0).
 *
 * Problem: /api/play/negotiate is stateless — it returns a stream URL and drops
 * the adapter's `session.close()` handle, so when a browser tab closes nothing
 * tells the backend to stop the transcode (ffmpeg orphans until the backend's
 * own slow inactivity timeout).
 *
 * Fix (best-practice, matches Jellyfin/Plex/Emby): the player sends a keepalive
 * every ~10s and a sendBeacon stop on tab close; a server-side reaper is the
 * backstop — any session that goes silent for REAP_AFTER_MS is stopped via the
 * adapter's close handle (Jellyfin Sessions/Playing/Stopped + transcode delete).
 *
 * The keepalive interval (10s) and reap threshold (30s = 3 missed pings) follow
 * Jellyfin's progress cadence; we can reap faster than Jellyfin's ~60s because
 * we control the client. The authoritative liveness signal is the heartbeat
 * here; a future hardening can prefer the Rust proxy's last-byte-written time
 * (more robust than a JS ping) — see the stream-proxy TODO.
 */

export const KEEPALIVE_MS = 10_000;
const REAP_AFTER_MS = 30_000;
const SWEEP_EVERY_MS = 10_000;

interface PlaybackSession {
	id: string;
	userId: string;
	/** Best-effort stop — maps to the adapter's session.close (backend stop). */
	stop: () => Promise<void>;
	lastSeen: number;
	createdAt: number;
	label: string;
}

const sessions = new Map<string, PlaybackSession>();
let reaper: ReturnType<typeof setInterval> | null = null;

function now() {
	return Date.now();
}

/** Max concurrent playback sessions per user. Each holds a real backend transcode
 *  + cred; without a cap, looping negotiate() pins unbounded ffmpeg jobs (DoS —
 *  adversarial review F2). On overflow we stop the user's OLDEST session. */
const MAX_SESSIONS_PER_USER = 8;

/** Register a live playback session and return its id. Idempotent per id. */
export function registerSession(opts: {
	id: string;
	userId: string;
	stop: () => Promise<void>;
	label?: string;
}): string {
	// Evict the user's oldest session(s) over the cap before adding a new one.
	const mine = [...sessions.values()]
		.filter((s) => s.userId === opts.userId)
		.sort((a, b) => a.createdAt - b.createdAt);
	for (let i = 0; i <= mine.length - MAX_SESSIONS_PER_USER; i++) {
		const victim = mine[i];
		sessions.delete(victim.id);
		console.warn(`[playback-sessions] session cap: evicting "${victim.label}"`);
		void victim.stop().catch(() => {});
	}
	sessions.set(opts.id, {
		id: opts.id,
		userId: opts.userId,
		stop: opts.stop,
		lastSeen: now(),
		createdAt: now(),
		label: opts.label ?? opts.id
	});
	ensureReaper();
	return opts.id;
}

/** Heartbeat: refresh lastSeen. Returns false if the session/user doesn't match
 *  (so a stale or spoofed id can't keep someone else's session alive). */
export function heartbeat(id: string, userId: string): boolean {
	const s = sessions.get(id);
	if (!s || s.userId !== userId) return false;
	s.lastSeen = now();
	return true;
}

/** Explicit stop (sendBeacon on tab close, or changeQuality teardown). Only the
 *  owning user may stop their session. */
export async function stopSession(id: string, userId: string): Promise<boolean> {
	const s = sessions.get(id);
	if (!s || s.userId !== userId) return false;
	sessions.delete(id);
	try {
		await s.stop();
	} catch (e) {
		console.warn(`[playback-sessions] stop("${s.label}") failed:`, e);
	}
	return true;
}

/** Reaper: stop+drop any session silent for longer than REAP_AFTER_MS. */
async function sweep(): Promise<void> {
	const cutoff = now() - REAP_AFTER_MS;
	const dead = [...sessions.values()].filter((s) => s.lastSeen < cutoff);
	for (const s of dead) {
		sessions.delete(s.id);
		console.log(
			`[playback-sessions] reaping "${s.label}" (silent ${Math.round((now() - s.lastSeen) / 1000)}s)`
		);
		try {
			await s.stop();
		} catch (e) {
			console.warn(`[playback-sessions] reap stop("${s.label}") failed:`, e);
		}
	}
	if (sessions.size === 0 && reaper) {
		clearInterval(reaper);
		reaper = null;
	}
}

function ensureReaper() {
	if (reaper) return;
	reaper = setInterval(() => {
		void sweep();
	}, SWEEP_EVERY_MS);
	// Don't keep the process alive solely for the reaper.
	if (typeof reaper === 'object' && 'unref' in reaper) (reaper as { unref(): void }).unref();
}

/** TEST/inspection: current live session count. */
export function liveSessionCount(): number {
	return sessions.size;
}
