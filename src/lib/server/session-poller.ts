import { getEnabledConfigs } from './services';
import { emitMediaEvent } from './analytics';
import { getDb, schema } from '../db';
import { eq } from 'drizzle-orm';

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

function resolveNexusUserId(jellyfinUserId: string): string | null {
	const db = getDb();
	const cred = db
		.select()
		.from(schema.userServiceCredentials)
		.where(eq(schema.userServiceCredentials.externalUserId, jellyfinUserId))
		.get();
	return cred?.userId ?? null;
}

function extractMetadata(session: JfSession): Record<string, unknown> {
	const meta: Record<string, unknown> = {};
	const item = session.NowPlayingItem;
	if (!item) return meta;

	const streams = (item.MediaStreams ?? []) as any[];
	const video = streams.find((s: any) => s.Type === 'Video');
	const audio = streams.find((s: any) => s.Type === 'Audio');
	const subtitle = streams.find((s: any) => s.Type === 'Subtitle');

	if (video) {
		meta.resolution = video.Height >= 2160 ? '4K' : video.Height >= 1080 ? '1080p' : video.Height >= 720 ? '720p' : `${video.Height}p`;
		meta.videoCodec = video.Codec;
		meta.hdr = video.VideoRangeType ?? 'sdr';
	}
	if (audio) {
		meta.audioCodec = audio.Codec;
		meta.audioChannels = audio.Channels > 6 ? '7.1' : audio.Channels > 2 ? '5.1' : 'stereo';
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
			activeSessions.delete(key);
		}
	}
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;

export function startSessionPoller() {
	if (pollInterval) return;
	console.log('[poller] Starting Jellyfin session poller (10s interval)');
	pollInterval = setInterval(() => {
		pollJellyfinSessions().catch((e) =>
			console.error('[poller] Unhandled error:', e)
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
