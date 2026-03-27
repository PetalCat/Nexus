import { getEnabledConfigs } from './services';
import { logger } from './logger';
import {
	resolveNexusUserId,
	getCredsForService,
	heightToResolution,
	channelsToLabel,
	emitMediaAction
} from './analytics';
import { updatePresence, isGhostMode, getFriendIds } from './social';
import { broadcastToFriends } from './ws';
import { getRawDb } from '../db';
import { randomBytes } from 'crypto';

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

interface JfSession {
	Id: string;
	UserId: string;
	UserName: string;
	Client: string;
	DeviceName: string;
	DeviceId: string;
	NowPlayingItem?: {
		Id: string;
		Name: string;
		Type: string;
		ProductionYear?: number;
		Genres?: string[];
		SeriesId?: string;
		SeriesName?: string;
		RunTimeTicks?: number;
		MediaStreams?: any[];
	};
	PlayState?: {
		PositionTicks?: number;
		IsPaused?: boolean;
		IsMuted?: boolean;
	};
	TranscodingInfo?: {
		IsTranscoding?: boolean;
		Bitrate?: number;
		TranscodeReasons?: string[];
	};
}

interface TrackedSession {
	sessionId: string;
	dbId: string;
	sessionKey: string;
	serviceId: string;
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

function insertSession(tracker: TrackedSession, metadata: Record<string, unknown>, genres?: string[], year?: number, parentId?: string, parentTitle?: string, deviceName?: string, clientName?: string): void {
	const db = getRawDb();
	const now = Date.now();
	db.prepare(`
		INSERT INTO play_sessions (id, session_key, user_id, service_id, service_type, media_id, media_type, media_title, media_year, media_genres, parent_id, parent_title, started_at, ended_at, duration_ms, media_duration_ms, progress, completed, device_name, client_name, metadata, source, created_at, updated_at)
		VALUES (?, ?, ?, ?, 'jellyfin', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, 0, 0, ?, ?, ?, 'poller', ?, ?)
		ON CONFLICT(session_key) DO UPDATE SET
			ended_at = NULL, duration_ms = 0, progress = 0, completed = 0, updated_at = excluded.updated_at
	`).run(
		tracker.dbId, tracker.sessionKey, tracker.userId, tracker.serviceId,
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

const JF_TYPE_MAP: Record<string, string> = {
	Movie: 'movie',
	Series: 'show',
	Episode: 'episode',
	Audio: 'music',
	MusicAlbum: 'album'
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const activeSessions = new Map<string, TrackedSession>();
let pollInterval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

function extractMetadata(session: JfSession): Record<string, unknown> {
	const meta: Record<string, unknown> = {};
	const item = session.NowPlayingItem;
	if (!item) return meta;

	const streams = (item.MediaStreams ?? []) as any[];
	const video = streams.find((s: any) => s.Type === 'Video');
	const audio = streams.find((s: any) => s.Type === 'Audio');
	const subtitle = streams.find((s: any) => s.Type === 'Subtitle');

	if (video) {
		meta.resolution = heightToResolution(video.Height);
		meta.videoCodec = video.Codec;
		meta.hdr = video.VideoRangeType ?? 'sdr';
	}
	if (audio) {
		meta.audioCodec = audio.Codec;
		meta.audioChannels = channelsToLabel(audio.Channels);
		meta.audioTrackLanguage = audio.Language;
	}
	if (subtitle) {
		meta.subtitleLanguage = subtitle.Language;
		meta.subtitleFormat = subtitle.Codec;
		meta.closedCaptions = !!subtitle.IsForced;
	}

	const ti = session.TranscodingInfo;
	if (ti) {
		meta.isTranscoding = ti.IsTranscoding;
		meta.bitrate = ti.Bitrate;
		meta.transcodeReason = ti.TranscodeReasons?.join(', ');
		meta.streamType = ti.IsTranscoding ? 'transcode' : 'direct-play';
	}

	return meta;
}

async function pollJellyfinSessions() {
	const configs = getEnabledConfigs().filter((c) => c.type === 'jellyfin');
	const now = Date.now();
	const seenKeys = new Set<string>();
	const failedServiceIds = new Set<string>();

	for (const config of configs) {
		try {
			const base = config.url.replace(/\/+$/, '');
			const res = await fetch(`${base}/Sessions`, {
				headers: {
					Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-poller-${config.id}", Version="1.0.0", Token="${config.apiKey ?? ''}"`,
					'X-Emby-Token': config.apiKey ?? ''
				},
				signal: AbortSignal.timeout(5000)
			});
			if (!res.ok) {
				failedServiceIds.add(config.id);
				continue;
			}

			const sessions: JfSession[] = await res.json();

			for (const session of sessions) {
				if (!session.NowPlayingItem) continue;
				const key = `${config.id}:${session.Id}`;
				seenKeys.add(key);

				const nexusUserId = resolveNexusUserId(session.UserId);
				if (!nexusUserId) continue;

				const existing = activeSessions.get(key);
				const item = session.NowPlayingItem;
				const isPaused = session.PlayState?.IsPaused ?? false;
				const mType = JF_TYPE_MAP[item.Type] ?? 'movie';

				const mediaDurationMs = item.RunTimeTicks ? item.RunTimeTicks / 10_000 : null;
				const positionTicks = session.PlayState?.PositionTicks;

				if (!existing) {
					// New session — insert into play_sessions
					const dbId = genId();
					const sessionKey = `${config.id}:${session.Id}`;
					const tracker: TrackedSession = {
						sessionId: key,
						dbId,
						sessionKey,
						serviceId: config.id,
						userId: nexusUserId,
						mediaId: item.Id,
						mediaType: mType,
						mediaTitle: item.Name,
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
					insertSession(tracker, extractMetadata(session), item.Genres, item.ProductionYear, item.SeriesId, item.SeriesName, session.DeviceName, session.Client);
					updateActivityPresence(nexusUserId, {
						mediaId: item.Id, mediaType: mType, mediaTitle: item.Name,
						serviceId: config.id, deviceName: session.DeviceName, clientName: session.Client
					});
				} else if (existing.mediaId !== item.Id) {
					// Media changed — close old session, start new one
					const finalPaused = existing.totalPausedMs + (existing.pausedSinceAt ? now - existing.pausedSinceAt : 0);
					const oldDuration = capDuration(existing.durationMs, existing.mediaDurationMs);
					const oldProgress = existing.mediaDurationMs ? Math.min(1, existing.durationMs / existing.mediaDurationMs) : null;
					const oldCompleted = oldProgress !== null && oldProgress >= 0.9;
					closeSession(existing.dbId, oldDuration, oldProgress, oldCompleted);

					const dbId = genId();
					const sessionKey = `${config.id}:${session.Id}`;
					const tracker: TrackedSession = {
						sessionId: key,
						dbId,
						sessionKey,
						serviceId: config.id,
						userId: nexusUserId,
						mediaId: item.Id,
						mediaType: mType,
						mediaTitle: item.Name,
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
					insertSession(tracker, extractMetadata(session), item.Genres, item.ProductionYear, item.SeriesId, item.SeriesName, session.DeviceName, session.Client);
					updateActivityPresence(nexusUserId, {
						mediaId: item.Id, mediaType: mType, mediaTitle: item.Name,
						serviceId: config.id, deviceName: session.DeviceName, clientName: session.Client
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

					// Calculate progress from position ticks or from accumulated duration
					let progress: number | null = null;
					if (positionTicks && existing.mediaDurationMs) {
						const positionMs = positionTicks / 10_000;
						progress = Math.min(1, positionMs / existing.mediaDurationMs);
					} else if (existing.mediaDurationMs) {
						progress = Math.min(1, existing.durationMs / existing.mediaDurationMs);
					}

					updateSessionTick(existing.dbId, existing.durationMs, progress);
				}
			}
		} catch (e) {
			failedServiceIds.add(config.id);
			logger.error('Failed to poll Jellyfin sessions', { service: config.name, err: e instanceof Error ? e.message : String(e) });
		}
	}

	// Detect ended sessions — but only for services we successfully polled.
	for (const [key, session] of activeSessions) {
		if (failedServiceIds.has(session.serviceId)) continue;
		if (!seenKeys.has(key)) {
			const progress = session.mediaDurationMs ? Math.min(1, session.durationMs / session.mediaDurationMs) : null;
			const completed = progress !== null && progress >= 0.9;
			closeSession(session.dbId, capDuration(session.durationMs, session.mediaDurationMs), progress, completed);
			updateActivityPresence(session.userId, null);
			activeSessions.delete(key);
		}
	}

	// Stale session cleanup
	const STALE_FLOOR_MS = 4 * 60 * 60 * 1000;
	for (const [key, session] of activeSessions) {
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
// RomM status poller — checks for game status changes (every 60s)
// ---------------------------------------------------------------------------

const rommStatusCache = new Map<string, string>();
let rommPollCount = 0;

async function pollRommStatuses() {
	const configs = getEnabledConfigs().filter((c) => c.type === 'romm');
	if (configs.length === 0) return;

	rommPollCount++;
	if (rommPollCount % 6 !== 0) return;

	for (const config of configs) {
		const creds = getCredsForService(config.id);

		for (const cred of creds) {
			if (!cred.externalUsername || !cred.accessToken) continue;

			try {
				const base = config.url.replace(/\/+$/, '');
				const res = await fetch(`${base}/api/roms?limit=50&order_by=updated_at&order_dir=desc`, {
					headers: {
						Authorization: 'Basic ' + btoa(`${cred.externalUsername}:${cred.accessToken}`)
					},
					signal: AbortSignal.timeout(8000)
				});
				if (!res.ok) continue;

				const data = await res.json();
				const roms = data?.items ?? data ?? [];

				for (const rom of roms) {
					const userStatus = rom.rom_user?.status;
					if (!userStatus) continue;

					const cacheKey = `${cred.userId}:${rom.id}`;
					const prevStatus = rommStatusCache.get(cacheKey);

					if (prevStatus !== userStatus) {
						rommStatusCache.set(cacheKey, userStatus);

						if (prevStatus !== undefined) {
							const genres = (rom.metadatum?.genres ?? rom.genres ?? [])
								.map((g: { name?: string } | string) => typeof g === 'string' ? g : g.name)
								.filter(Boolean) as string[];

							const mediaTitle = rom.name || rom.fs_name_no_ext;
							const mediaId = String(rom.id);

							if (userStatus === 'playing') {
								// Insert a play session for game start
								const dbId = genId();
								const sessionKey = `romm:${config.id}:${cred.userId}:${rom.id}`;
								const now = Date.now();
								getRawDb().prepare(`
									INSERT INTO play_sessions (id, session_key, user_id, service_id, service_type, media_id, media_type, media_title, media_genres, parent_title, started_at, duration_ms, source, created_at, updated_at)
									VALUES (?, ?, ?, ?, 'romm', ?, 'game', ?, ?, ?, ?, 0, 'poller', ?, ?)
									ON CONFLICT(session_key) DO UPDATE SET
										ended_at = NULL, duration_ms = 0, updated_at = excluded.updated_at
								`).run(
									dbId, sessionKey, cred.userId, config.id,
									mediaId, mediaTitle,
									genres.length > 0 ? JSON.stringify(genres) : null,
									rom.platform_display_name ?? null,
									now, now, now
								);
							} else if (userStatus === 'finished' || userStatus === 'completed' || userStatus === 'retired') {
								// Close any open session for this game
								const openSession = getRawDb().prepare(
									`SELECT id, duration_ms, media_duration_ms FROM play_sessions WHERE user_id = ? AND media_id = ? AND service_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`
								).get(cred.userId, mediaId, config.id) as any;
								if (openSession) {
									closeSession(openSession.id, capDuration(openSession.duration_ms ?? 0, openSession.media_duration_ms), null, userStatus === 'finished' || userStatus === 'completed');
								}
								// Also emit a media action
								emitMediaAction({
									userId: cred.userId,
									serviceId: config.id,
									serviceType: 'romm',
									actionType: userStatus === 'finished' || userStatus === 'completed' ? 'complete' : 'mark_watched',
									mediaId,
									mediaType: 'game',
									mediaTitle,
									metadata: {
										platform: rom.platform_display_name,
										platformSlug: rom.platform_slug,
										userStatus,
										previousStatus: prevStatus,
										lastPlayed: rom.rom_user?.last_played
									}
								});
							} else {
								// Other status changes (wishlist, etc.) — emit as media action
								const actionMap: Record<string, string> = {
									wishlist: 'add_to_watchlist'
								};
								emitMediaAction({
									userId: cred.userId,
									serviceId: config.id,
									serviceType: 'romm',
									actionType: actionMap[userStatus] ?? 'status_change',
									mediaId,
									mediaType: 'game',
									mediaTitle,
									metadata: {
										platform: rom.platform_display_name,
										platformSlug: rom.platform_slug,
										userStatus,
										previousStatus: prevStatus,
										lastPlayed: rom.rom_user?.last_played
									}
								});
							}
						}
					}
				}
			} catch (e) {
				logger.error('RomM poll error', { service: config.name, err: e instanceof Error ? e.message : String(e) });
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;

export function startSessionPoller() {
	if (pollInterval) return;
	logger.info('Starting session poller', { jellyfin: '10s', romm: '60s' });
	pollInterval = setInterval(() => {
		pollJellyfinSessions().catch((e) =>
			logger.error('Jellyfin poll error', { err: e instanceof Error ? e.message : String(e) })
		);
		pollRommStatuses().catch((e) =>
			logger.error('RomM poll error', { err: e instanceof Error ? e.message : String(e) })
		);
	}, POLL_INTERVAL_MS);
	// Run immediately on start
	pollJellyfinSessions().catch(() => {});
}

export function stopSessionPoller() {
	if (pollInterval) {
		clearInterval(pollInterval);
		pollInterval = null;
		logger.info('Session poller stopped');
	}
}
