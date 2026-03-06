import { getEnabledConfigs } from './services';
import {
	emitMediaEvent,
	resolveNexusUserId,
	getCredsForService,
	heightToResolution,
	channelsToLabel
} from './analytics';
import { updatePresence, isGhostMode, getFriendIds } from './social';
import { broadcastToFriends } from './ws';

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
	serviceId: string;
	userId: string;
	mediaId: string;
	mediaType: string;
	mediaTitle: string;
	isPaused: boolean;
	startedAt: number;
	lastSeenAt: number;
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
			if (!res.ok) continue;

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

				if (!existing) {
					// New session — emit play_start
					activeSessions.set(key, {
						sessionId: key,
						serviceId: config.id,
						userId: nexusUserId,
						mediaId: item.Id,
						mediaType: mType,
						mediaTitle: item.Name,
						isPaused,
						startedAt: now,
						lastSeenAt: now
					});
					emitMediaEvent({
						userId: nexusUserId,
						serviceId: config.id,
						serviceType: 'jellyfin',
						eventType: 'play_start',
						mediaId: item.Id,
						mediaType: mType,
						mediaTitle: item.Name,
						mediaYear: item.ProductionYear,
						mediaGenres: item.Genres,
						parentId: item.SeriesId,
						parentTitle: item.SeriesName,
						positionTicks: session.PlayState?.PositionTicks,
						durationTicks: item.RunTimeTicks,
						deviceName: session.DeviceName,
						clientName: session.Client,
						metadata: extractMetadata(session)
					});
					updateActivityPresence(nexusUserId, {
						mediaId: item.Id, mediaType: mType, mediaTitle: item.Name,
						serviceId: config.id, deviceName: session.DeviceName, clientName: session.Client
					});
				} else if (existing.mediaId !== item.Id) {
					// Media changed — stop old, start new
					emitMediaEvent({
						userId: nexusUserId,
						serviceId: config.id,
						serviceType: 'jellyfin',
						eventType: 'play_stop',
						mediaId: existing.mediaId,
						mediaType: existing.mediaType,
						mediaTitle: existing.mediaTitle,
						playDurationMs: now - existing.startedAt,
						timestamp: now
					});
					activeSessions.set(key, {
						sessionId: key,
						serviceId: config.id,
						userId: nexusUserId,
						mediaId: item.Id,
						mediaType: mType,
						mediaTitle: item.Name,
						isPaused,
						startedAt: now,
						lastSeenAt: now
					});
					emitMediaEvent({
						userId: nexusUserId,
						serviceId: config.id,
						serviceType: 'jellyfin',
						eventType: 'play_start',
						mediaId: item.Id,
						mediaType: mType,
						mediaTitle: item.Name,
						mediaYear: item.ProductionYear,
						mediaGenres: item.Genres,
						parentId: item.SeriesId,
						parentTitle: item.SeriesName,
						positionTicks: session.PlayState?.PositionTicks,
						durationTicks: item.RunTimeTicks,
						deviceName: session.DeviceName,
						clientName: session.Client,
						metadata: extractMetadata(session)
					});
					updateActivityPresence(nexusUserId, {
						mediaId: item.Id, mediaType: mType, mediaTitle: item.Name,
						serviceId: config.id, deviceName: session.DeviceName, clientName: session.Client
					});
				} else {
					// Same media — detect pause/resume
					if (isPaused && !existing.isPaused) {
						emitMediaEvent({
							userId: nexusUserId,
							serviceId: config.id,
							serviceType: 'jellyfin',
							eventType: 'play_pause',
							mediaId: item.Id,
							mediaType: mType,
							mediaTitle: item.Name,
							positionTicks: session.PlayState?.PositionTicks,
							durationTicks: item.RunTimeTicks,
							deviceName: session.DeviceName,
							clientName: session.Client
						});
					} else if (!isPaused && existing.isPaused) {
						emitMediaEvent({
							userId: nexusUserId,
							serviceId: config.id,
							serviceType: 'jellyfin',
							eventType: 'play_resume',
							mediaId: item.Id,
							mediaType: mType,
							mediaTitle: item.Name,
							positionTicks: session.PlayState?.PositionTicks,
							durationTicks: item.RunTimeTicks,
							deviceName: session.DeviceName,
							clientName: session.Client
						});
					}
					existing.isPaused = isPaused;
					existing.lastSeenAt = now;
				}
			}
		} catch (e) {
			console.error(`[poller] Failed to poll ${config.name}:`, e instanceof Error ? e.message : e);
		}
	}

	// Detect ended sessions
	for (const [key, session] of activeSessions) {
		if (!seenKeys.has(key)) {
			emitMediaEvent({
				userId: session.userId,
				serviceId: session.serviceId,
				serviceType: 'jellyfin',
				eventType: 'play_stop',
				mediaId: session.mediaId,
				mediaType: session.mediaType,
				mediaTitle: session.mediaTitle,
				playDurationMs: now - session.startedAt,
				timestamp: now
			});
			updateActivityPresence(session.userId, null);
			activeSessions.delete(key);
		}
	}
}

// ---------------------------------------------------------------------------
// RomM status poller — checks for game status changes (every 60s)
// ---------------------------------------------------------------------------

// Track last known status per user+game to detect changes
const rommStatusCache = new Map<string, string>(); // key: userId:gameId -> status
let rommPollCount = 0;

async function pollRommStatuses() {
	const configs = getEnabledConfigs().filter((c) => c.type === 'romm');
	if (configs.length === 0) return;

	rommPollCount++;
	// Only poll every 6th tick (60s) to avoid hammering the RomM API
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

						// Don't emit on first load (prevStatus undefined) to avoid flooding
						if (prevStatus !== undefined) {
							const statusEventMap: Record<string, string> = {
								playing: 'play_start',
								finished: 'complete',
								completed: 'complete',
								retired: 'mark_watched',
								wishlist: 'add_to_watchlist'
							};

							const genres = (rom.metadatum?.genres ?? rom.genres ?? [])
								.map((g: { name?: string } | string) => typeof g === 'string' ? g : g.name)
								.filter(Boolean) as string[];

							emitMediaEvent({
								userId: cred.userId,
								serviceId: config.id,
								serviceType: 'romm',
								eventType: statusEventMap[userStatus] ?? 'mark_watched',
								mediaId: String(rom.id),
								mediaType: 'game',
								mediaTitle: rom.name || rom.fs_name_no_ext,
								mediaGenres: genres.length > 0 ? genres : undefined,
								parentTitle: rom.platform_display_name,
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
			} catch (e) {
				console.error(`[poller] RomM poll error for ${config.name}:`, e instanceof Error ? e.message : e);
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
	console.log('[poller] Starting session poller (Jellyfin 10s, RomM 60s)');
	pollInterval = setInterval(() => {
		pollJellyfinSessions().catch((e) =>
			console.error('[poller] Jellyfin error:', e)
		);
		pollRommStatuses().catch((e) =>
			console.error('[poller] RomM error:', e)
		);
	}, POLL_INTERVAL_MS);
	// Run immediately on start
	pollJellyfinSessions().catch(() => {});
}

export function stopSessionPoller() {
	if (pollInterval) {
		clearInterval(pollInterval);
		pollInterval = null;
		console.log('[poller] Session poller stopped');
	}
}
