import { getEnabledConfigs } from './services';
import { logger } from './logger';
import {
	resolveNexusUserId,
	getCredsForService,
	emitMediaAction
} from './analytics';
import { updatePresence, isGhostMode, getFriendIds } from './social';
import { broadcastToFriends } from './ws';
import { getRawDb } from '../db';
import { randomBytes } from 'crypto';
import { registry } from '../adapters/registry';
import type { NexusSession } from '../adapters/types';

function updateActivityPresence(userId: string, activity: Record<string, unknown> | null) {
	updatePresence(userId, { currentActivity: activity, lastSeen: Date.now() });
	if (!isGhostMode(userId)) {
		const type = activity ? 'presence:activity_started' : 'presence:activity_stopped';
		broadcastToFriends(userId, { type, data: activity ? { userId, activity } : { userId } }, () => getFriendIds(userId));
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrackedSession {
	sessionId: string;
	dbId: string;
	sessionKey: string;
	serviceId: string;
	serviceType: string;
	userId: string;
	mediaId: string;
	mediaType: string;
	mediaTitle: string;
	isPaused: boolean;
	startedAt: number;
	lastTickAt: number;
	lastSeenAt: number;
	pausedSinceAt: number | null;
	totalPausedMs: number;
	durationMs: number;
	mediaDurationMs: number | null;
}

/** Cap play duration at media runtime + 10% tolerance (for credits, buffering) */
function capDuration(rawMs: number, mediaDurationMs: number | null): number {
	if (mediaDurationMs && rawMs > mediaDurationMs * 1.1) return mediaDurationMs;
	return Math.max(0, rawMs);
}

function genId(): string {
	return randomBytes(12).toString('hex');
}

function insertSession(
	tracker: TrackedSession,
	metadata: Record<string, unknown>,
	genres?: string[],
	year?: number,
	parentId?: string,
	parentTitle?: string,
	deviceName?: string,
	clientName?: string
): void {
	const db = getRawDb();
	const now = Date.now();
	db.prepare(`
		INSERT INTO play_sessions (id, session_key, user_id, service_id, service_type, media_id, media_type, media_title, media_year, media_genres, parent_id, parent_title, started_at, ended_at, duration_ms, media_duration_ms, progress, completed, device_name, client_name, metadata, source, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, 0, 0, ?, ?, ?, 'poller', ?, ?)
		ON CONFLICT(session_key) DO UPDATE SET
			ended_at = NULL, duration_ms = 0, progress = 0, completed = 0, updated_at = excluded.updated_at
	`).run(
		tracker.dbId, tracker.sessionKey, tracker.userId, tracker.serviceId,
		tracker.serviceType,
		tracker.mediaId, tracker.mediaType, tracker.mediaTitle,
		year ?? null, genres ? JSON.stringify(genres) : null,
		parentId ?? null, parentTitle ?? null,
		tracker.startedAt, tracker.mediaDurationMs ?? null,
		deviceName ?? null, clientName ?? null,
		Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
		now, now
	);
}

function updateSessionTick(dbId: string, durationMs: number, progress: number | null): void {
	getRawDb().prepare(
		`UPDATE play_sessions SET duration_ms = ?, progress = ?, updated_at = ? WHERE id = ?`
	).run(durationMs, progress, Date.now(), dbId);
}

function closeSession(dbId: string, finalDurationMs: number, progress: number | null, completed: boolean): void {
	const now = Date.now();
	getRawDb().prepare(
		`UPDATE play_sessions SET ended_at = ?, duration_ms = ?, progress = ?, completed = ?, updated_at = ? WHERE id = ?`
	).run(now, finalDurationMs, progress, completed ? 1 : 0, now, dbId);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const activeSessions = new Map<string, TrackedSession>();

// Per-adapter poll timers
const adapterTimers = new Map<string, ReturnType<typeof setInterval>>();

// Track previous NexusSession state for status-change detection (used by adapters
// that report status changes like playing->finished rather than live playback)
const previousSessionState = new Map<string, string>();

// ---------------------------------------------------------------------------
// Core — generic session processing
// ---------------------------------------------------------------------------

function processAdapterSessions(
	serviceId: string,
	serviceType: string,
	sessions: NexusSession[],
	now: number,
	seenKeys: Set<string>
) {
	for (const ns of sessions) {
		const key = `${serviceId}:${ns.sessionId}`;
		seenKeys.add(key);

		// Resolve Nexus user ID from the external user ID
		const nexusUserId = ns.userId ? resolveNexusUserId(ns.userId, serviceId) : null;
		if (!nexusUserId) continue;

		// Track status changes for non-live sessions (e.g. game status transitions)
		const prevStateKey = `${serviceId}:${ns.sessionId}:state`;
		const prevState = previousSessionState.get(prevStateKey);
		previousSessionState.set(prevStateKey, ns.state);

		// Handle stopped sessions reported by adapter (e.g. game finished/completed)
		if (ns.state === 'stopped') {
			const existing = activeSessions.get(key);
			if (existing) {
				const progress = existing.mediaDurationMs ? Math.min(1, existing.durationMs / existing.mediaDurationMs) : null;
				closeSession(existing.dbId, capDuration(existing.durationMs, existing.mediaDurationMs), progress, true);
				updateActivityPresence(existing.userId, null);
				activeSessions.delete(key);
			}
			// Emit media action for status transition
			if (prevState && prevState !== 'stopped') {
				emitMediaAction({
					userId: nexusUserId,
					serviceId,
					serviceType,
					actionType: 'complete',
					mediaId: ns.mediaId,
					mediaType: ns.mediaType,
					mediaTitle: ns.mediaTitle,
					metadata: ns.metadata ?? {}
				});
			}
			continue;
		}

		const existing = activeSessions.get(key);
		const isPaused = ns.state === 'paused';
		const mediaDurationMs = ns.durationSeconds ? ns.durationSeconds * 1000 : null;
		const positionMs = ns.positionSeconds ? ns.positionSeconds * 1000 : null;

		if (!existing) {
			// New session — insert into play_sessions
			const dbId = genId();
			const sessionKey = `${serviceId}:${ns.sessionId}`;
			const tracker: TrackedSession = {
				sessionId: key,
				dbId,
				sessionKey,
				serviceId,
				serviceType,
				userId: nexusUserId,
				mediaId: ns.mediaId,
				mediaType: ns.mediaType,
				mediaTitle: ns.mediaTitle,
				isPaused,
				startedAt: now,
				lastTickAt: now,
				lastSeenAt: now,
				pausedSinceAt: isPaused ? now : null,
				totalPausedMs: 0,
				durationMs: 0,
				mediaDurationMs
			};
			activeSessions.set(key, tracker);
			insertSession(
				tracker, ns.metadata ?? {},
				ns.genres, ns.year,
				ns.parentId, ns.parentTitle,
				ns.device, ns.client
			);
			updateActivityPresence(nexusUserId, {
				mediaId: ns.mediaId, mediaType: ns.mediaType, mediaTitle: ns.mediaTitle,
				serviceId, deviceName: ns.device, clientName: ns.client
			});
		} else if (existing.mediaId !== ns.mediaId) {
			// Media changed — close old session, start new one
			const finalPaused = existing.totalPausedMs + (existing.pausedSinceAt ? now - existing.pausedSinceAt : 0);
			const oldDuration = capDuration(existing.durationMs, existing.mediaDurationMs);
			const oldProgress = existing.mediaDurationMs ? Math.min(1, existing.durationMs / existing.mediaDurationMs) : null;
			const oldCompleted = oldProgress !== null && oldProgress >= 0.9;
			closeSession(existing.dbId, oldDuration, oldProgress, oldCompleted);

			const dbId = genId();
			const sessionKey = `${serviceId}:${ns.sessionId}`;
			const tracker: TrackedSession = {
				sessionId: key,
				dbId,
				sessionKey,
				serviceId,
				serviceType,
				userId: nexusUserId,
				mediaId: ns.mediaId,
				mediaType: ns.mediaType,
				mediaTitle: ns.mediaTitle,
				isPaused,
				startedAt: now,
				lastTickAt: now,
				lastSeenAt: now,
				pausedSinceAt: isPaused ? now : null,
				totalPausedMs: 0,
				durationMs: 0,
				mediaDurationMs
			};
			activeSessions.set(key, tracker);
			insertSession(
				tracker, ns.metadata ?? {},
				ns.genres, ns.year,
				ns.parentId, ns.parentTitle,
				ns.device, ns.client
			);
			updateActivityPresence(nexusUserId, {
				mediaId: ns.mediaId, mediaType: ns.mediaType, mediaTitle: ns.mediaTitle,
				serviceId, deviceName: ns.device, clientName: ns.client
			});
		} else {
			// Same media — handle pause/resume and accumulate duration
			if (isPaused && !existing.isPaused) {
				existing.pausedSinceAt = now;
			} else if (!isPaused && existing.isPaused) {
				if (existing.pausedSinceAt) {
					existing.totalPausedMs += now - existing.pausedSinceAt;
				}
				existing.pausedSinceAt = null;
			}
			existing.isPaused = isPaused;

			// Accumulate active play time (only when not paused)
			if (!isPaused) {
				existing.durationMs += (now - existing.lastTickAt);
				// Cap at mediaDurationMs * 1.1 if available
				if (existing.mediaDurationMs && existing.durationMs > existing.mediaDurationMs * 1.1) {
					existing.durationMs = existing.mediaDurationMs;
				}
			}

			existing.lastTickAt = now;
			existing.lastSeenAt = now;

			// Calculate progress from position or from accumulated duration
			let progress: number | null = null;
			if (positionMs && existing.mediaDurationMs) {
				progress = Math.min(1, positionMs / existing.mediaDurationMs);
			} else if (existing.mediaDurationMs) {
				progress = Math.min(1, existing.durationMs / existing.mediaDurationMs);
			}

			updateSessionTick(existing.dbId, existing.durationMs, progress);
		}
	}
}

async function pollAdapterSessions(serviceType: string) {
	const configs = getEnabledConfigs().filter((c) => c.type === serviceType);
	const adapter = registry.get(serviceType);
	if (!adapter?.pollSessions) return;

	const now = Date.now();
	const seenKeys = new Set<string>();
	const failedServiceIds = new Set<string>();

	for (const config of configs) {
		try {
			const sessions = await adapter.pollSessions(config);
			processAdapterSessions(config.id, serviceType, sessions, now, seenKeys);
		} catch (e) {
			failedServiceIds.add(config.id);
			logger.error('Session poll error', { service: config.name, type: serviceType, err: e instanceof Error ? e.message : String(e) });
		}
	}

	// Detect ended sessions — but only for services of this adapter type that we successfully polled.
	for (const [key, session] of activeSessions) {
		if (session.serviceType !== serviceType) continue;
		if (failedServiceIds.has(session.serviceId)) continue;
		if (!seenKeys.has(key)) {
			const progress = session.mediaDurationMs ? Math.min(1, session.durationMs / session.mediaDurationMs) : null;
			const completed = progress !== null && progress >= 0.9;
			closeSession(session.dbId, capDuration(session.durationMs, session.mediaDurationMs), progress, completed);
			updateActivityPresence(session.userId, null);
			activeSessions.delete(key);
		}
	}

	// Stale session cleanup for this adapter type
	const STALE_FLOOR_MS = 4 * 60 * 60 * 1000;
	for (const [key, session] of activeSessions) {
		if (session.serviceType !== serviceType) continue;
		const staleThreshold = Math.max((session.mediaDurationMs ?? 0) * 1.5, STALE_FLOOR_MS);
		if (now - session.lastSeenAt > staleThreshold) {
			closeSession(session.dbId, capDuration(session.durationMs, session.mediaDurationMs), null, false);
			updateActivityPresence(session.userId, null);
			activeSessions.delete(key);
			logger.info('Auto-closed stale session', { title: session.mediaTitle, key });
		}
	}
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 10_000;

export function startSessionPoller() {
	if (adapterTimers.size > 0) return;

	// Find all adapters that implement pollSessions
	const adapters = registry.all().filter((a) => typeof a.pollSessions === 'function');
	if (adapters.length === 0) {
		logger.info('No adapters with pollSessions — session poller not started');
		return;
	}

	const intervals: string[] = [];
	for (const adapter of adapters) {
		const intervalMs = adapter.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		intervals.push(`${adapter.id}=${intervalMs / 1000}s`);

		const timer = setInterval(() => {
			pollAdapterSessions(adapter.id).catch((e) =>
				logger.error('Session poll error', { adapter: adapter.id, err: e instanceof Error ? e.message : String(e) })
			);
		}, intervalMs);
		adapterTimers.set(adapter.id, timer);
	}

	logger.info('Starting session poller', { adapters: intervals.join(', ') });

	// Run all adapters immediately on start
	for (const adapter of adapters) {
		pollAdapterSessions(adapter.id).catch(() => {});
	}
}

export function stopSessionPoller() {
	if (adapterTimers.size > 0) {
		for (const [id, timer] of adapterTimers) {
			clearInterval(timer);
		}
		adapterTimers.clear();
		logger.info('Session poller stopped');
	}
}
