/**
 * Jellyfin adapter — v2 (Nexus-owns-identity).
 *
 * ONE service credential (a dashboard API key, preferred) held by Nexus. No
 * per-user auth surface: every method takes `(config, …)`. Stream bytes never
 * cross the browser→Jellyfin boundary — `negotiatePlayback` mints a grant the
 * Rust proxy verifies while holding the cred, and the browser only ever sees a
 * Nexus-origin `/api/stream-proxy/...` URL.
 *
 * PORTED verbatim (certified mappers): normalize/mediaType/FIELDS, the playback
 * mappers (derivePlaybackMode, filter*Tracks, mapPlaybackInfoToSession via the
 * local buildSession), buildDeviceProfile, extractSessionMetadata,
 * JF_SESSION_TYPE_MAP, image-URL builders, PRESET_BITRATES, ticks→seconds.
 *
 * REBUILT (the Nexus-owns-identity spine): the entire auth surface — a single
 * jfFetch with the exact MediaBrowser header, getUserId (one representative
 * admin, /Users/Me → /Users fallthrough), probeServiceCredential via
 * /System/Info, and the proxy handoff (grant mint instead of raw auth headers).
 *
 * See _runtime-evidence/ADAPTER-BUILD-SPECS.md → "ADAPTER 1 — JELLYFIN".
 */

import type {
	NexusSession,
	ServiceConfig,
	ServiceHealth,
	SyncItem,
	UnifiedMedia,
	UnifiedSearchResult
} from '../types';
import type {
	BrowserCaps,
	PlaybackMode,
	PlaybackPlan,
	PlaybackSession,
	TrackInfo
} from '../playback';
import type { CredentialProbeResult, LibraryPage, LibraryQuery, NexusAdapter } from './contract';
import { declareAdapter } from './contract';
import { heightToResolution, channelsToLabel } from '../../server/analytics';
import { createStreamSession } from '../../server/stream-proxy';

// ─────────────────────────────────────────────────────────────────────────────
// Auth & fetch — REBUILT for the single service credential.
// ─────────────────────────────────────────────────────────────────────────────

/** Admin userId resolved once per config.id (indefinite cache). */
const userIdCache = new Map<string, string>();

/**
 * The exact, literal MediaBrowser auth header. Scheme `MediaBrowser`,
 * case-sensitive keys, double-quoted values, comma-separated. ONE token. The
 * DeviceId is scoped to config.id so this install owns a single session slot.
 */
function authHeader(config: ServiceConfig): string {
	const token = config.apiKey ?? '';
	return `MediaBrowser Token="${token}", Client="Nexus", Device="Nexus Server", DeviceId="nexus-${config.id}", Version="1.0.0"`;
}

/** Headers for an authed Jellyfin request. Leads with the MediaBrowser header;
 *  X-Emby-Token only as a secondary legacy fallback. Never two tokens in a query. */
function authHeaders(config: ServiceConfig): Record<string, string> {
	const token = config.apiKey ?? '';
	return {
		Authorization: authHeader(config),
		'X-Emby-Token': token
	};
}

function baseUrl(config: ServiceConfig): string {
	return config.url.replace(/\/+$/, '');
}

/** Single jfFetch — one cred, no two-token branching (PORT-but-collapse). */
async function jfFetch(
	config: ServiceConfig,
	path: string,
	params?: Record<string, string>,
	timeoutMs = 8000
): Promise<any> {
	const url = new URL(`${baseUrl(config)}${path}`);
	if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url.toString(), {
		headers: { ...authHeaders(config), Accept: 'application/json' },
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`Jellyfin ${path} → ${res.status}`);
	return res.json();
}

/**
 * Resolve ONE representative admin userId, cached per config.id. /Users/Me works
 * for an admin access token but 400s for a dashboard API key — catch and fall
 * through to /Users (first admin, else first user). No per-user short-circuit.
 */
async function getUserId(config: ServiceConfig): Promise<string> {
	const cached = userIdCache.get(config.id);
	if (cached) return cached;

	try {
		const me = await jfFetch(config, '/Users/Me');
		if (me?.Id) {
			userIdCache.set(config.id, me.Id as string);
			return me.Id as string;
		}
	} catch {
		// API key → /Users/Me 400s; fall through to /Users.
	}

	const users = await jfFetch(config, '/Users');
	const list: Array<{ Id: string; Policy?: { IsAdministrator?: boolean } }> = Array.isArray(users)
		? users
		: (users.Items ?? []);
	const admin = list.find((u) => u.Policy?.IsAdministrator);
	const id = (admin ?? list[0])?.Id;
	if (!id) throw new Error('Jellyfin: no users found via GET /Users');
	userIdCache.set(config.id, id);
	return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation — PORTED verbatim.
// ─────────────────────────────────────────────────────────────────────────────

const FIELDS =
	'Overview,Genres,Studios,BackdropImageTags,ImageTags,UserData,ParentId,SeriesId,SeriesName,ParentIndexNumber,IndexNumber,AlbumArtist,Artists,ArtistItems,Album,AlbumId,RemoteTrailers,ProviderIds';
const DETAIL_FIELDS = `${FIELDS},People,MediaStreams,Chapters`;

function mediaType(jfType: string): UnifiedMedia['type'] {
	switch (jfType) {
		case 'Movie':
			return 'movie';
		case 'Series':
			return 'show';
		case 'Episode':
			return 'episode';
		case 'MusicAlbum':
			return 'album';
		case 'Audio':
			return 'music';
		case 'LiveTvChannel':
			return 'live';
		default:
			return 'movie';
	}
}

function proxyPath(config: ServiceConfig, path: string): string {
	return `/api/media/image?service=${encodeURIComponent(config.id)}&path=${encodeURIComponent(path)}`;
}
function posterUrl(config: ServiceConfig, itemId: string) {
	return proxyPath(config, `/Items/${itemId}/Images/Primary?quality=90&maxWidth=600`);
}
function thumbUrl(config: ServiceConfig, itemId: string) {
	return proxyPath(config, `/Items/${itemId}/Images/Primary?quality=90&maxWidth=800`);
}
function backdropUrl(config: ServiceConfig, itemId: string, index = 0) {
	return proxyPath(config, `/Items/${itemId}/Images/Backdrop/${index}?quality=90&maxWidth=1920`);
}

function buildStreamUrl(config: ServiceConfig, item: any): string | undefined {
	const type = item.Type;
	if (['Movie', 'Episode', 'Audio', 'LiveTvChannel'].includes(type)) {
		return `/api/stream/${config.id}/${item.Id}`;
	}
	return undefined;
}

function normalize(config: ServiceConfig, item: any): UnifiedMedia {
	const type = mediaType(item.Type);
	const ud = item.UserData;

	const isEpisode = item.Type === 'Episode';
	const hasPrimary = item.ImageTags?.Primary;
	const posterItemId = isEpisode
		? (item.SeriesId ?? item.ParentId ?? (hasPrimary ? item.Id : null))
		: hasPrimary
			? item.Id
			: (item.SeriesId ?? item.ParentId ?? null);
	const thumbItemId = isEpisode && hasPrimary ? item.Id : null;
	const hasBackdrop = (item.BackdropImageTags?.length ?? 0) > 0;
	const backdropItemId = hasBackdrop ? item.Id : (item.ParentBackdropItemId ?? null);

	let progress: number | undefined;
	if (ud?.PlayedPercentage != null) {
		progress = Math.min(1, ud.PlayedPercentage / 100);
	} else if (ud?.PlaybackPositionTicks && item.RunTimeTicks) {
		progress = Math.min(1, ud.PlaybackPositionTicks / item.RunTimeTicks);
	}

	const cast: Array<{ name: string; role: string; type: string; imageUrl?: string }> = [];
	if (Array.isArray(item.People)) {
		for (const p of item.People) {
			cast.push({
				name: p.Name ?? '',
				role: p.Role ?? p.Type ?? '',
				type: p.Type ?? 'Actor',
				imageUrl: p.PrimaryImageTag
					? proxyPath(config, `/Items/${p.Id}/Images/Primary?quality=90&maxWidth=200`)
					: undefined
			});
		}
	}

	return {
		id: `${item.Id}:${config.id}`,
		sourceId: item.Id,
		serviceId: config.id,
		serviceType: 'jellyfin',
		type,
		title: item.Name ?? 'Unknown',
		sortTitle: item.SortName,
		description: item.Overview,
		poster: posterItemId ? posterUrl(config, posterItemId) : undefined,
		backdrop: backdropItemId ? backdropUrl(config, backdropItemId) : undefined,
		thumb: thumbItemId ? thumbUrl(config, thumbItemId) : undefined,
		year: item.ProductionYear,
		rating: item.CommunityRating,
		genres: item.Genres ?? [],
		studios: item.Studios?.map((s: { Name: string }) => s.Name) ?? [],
		duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000_000) : undefined,
		status: 'available',
		progress,
		metadata: {
			jellyfinId: item.Id,
			userData: ud,
			seriesId: item.SeriesId,
			seriesName: item.SeriesName,
			seasonNumber: item.ParentIndexNumber,
			episodeNumber: item.IndexNumber,
			episodeTitle: item.Type === 'Episode' ? item.Name : undefined,
			cast,
			officialRating: item.OfficialRating ?? undefined,
			criticRating: item.CriticRating ?? undefined,
			taglines: item.Taglines ?? [],
			trailerUrl: item.RemoteTrailers?.[0]?.Url ?? null,
			tmdbId: item.ProviderIds?.Tmdb ?? null,
			imdbId: item.ProviderIds?.Imdb ?? null,
			providerIds: item.ProviderIds ?? {},
			endDate: item.EndDate,
			artist: item.AlbumArtist ?? item.Artists?.[0] ?? item.ArtistItems?.[0]?.Name,
			artistId: item.ArtistItems?.[0]?.Id,
			albumId: item.AlbumId,
			albumName: item.Album,
			trackNumber: item.IndexNumber,
			discNumber: item.ParentIndexNumber
		},
		actionLabel: type === 'music' || type === 'album' ? 'Listen' : 'Watch',
		actionUrl: `${baseUrl(config)}/web/index.html#!/details?id=${item.Id}`,
		streamUrl: buildStreamUrl(config, item)
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Playback mappers — PORTED from jellyfin-playback.ts (logic certified).
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_SUB_CODECS = new Set([
	'pgssub',
	'pgs',
	'dvbsub',
	'dvdsub',
	'vobsub',
	'hdmv_pgs_subtitle'
]);

const PRESET_BITRATES: Record<number, number> = {
	2160: 35_000_000,
	1440: 16_000_000,
	1080: 8_000_000,
	720: 4_000_000,
	480: 2_000_000,
	360: 1_000_000,
	240: 500_000
};

export function derivePlaybackMode(source: {
	SupportsDirectPlay?: boolean;
	SupportsDirectStream?: boolean;
	TranscodingUrl?: string | null;
}): PlaybackMode {
	// Refine via the TranscodingUrl query when present (4-mode distinction).
	if (source.TranscodingUrl) {
		try {
			const qs = new URLSearchParams(source.TranscodingUrl.split('?')[1] ?? '');
			const hasVideoCodec = qs.has('VideoCodec');
			const hasAudioCodec = qs.has('AudioCodec');
			// Jellyfin always stamps VideoCodec/AudioCodec on a transcode URL; the
			// TranscodeReasons (carried separately) is the authoritative "why". We
			// treat any TranscodingUrl as a server-decided non-direct plan: a true
			// video transcode unless only the audio differs (direct-stream) or
			// neither (remux). Absent reasons we conservatively call it transcode.
			if (hasVideoCodec && hasAudioCodec) return 'transcode';
			if (hasAudioCodec) return 'direct-stream';
			return 'remux';
		} catch {
			return 'transcode';
		}
	}
	if (source.SupportsDirectPlay) return 'direct-play';
	if (source.SupportsDirectStream) return 'direct-stream';
	return 'transcode';
}

function isTextSub(s: any): boolean {
	if (typeof s.IsTextSubtitleStream === 'boolean') return s.IsTextSubtitleStream;
	return !IMAGE_SUB_CODECS.has(String(s.Codec ?? '').toLowerCase());
}

function subLabel(s: any): string {
	return (s.DisplayTitle ?? s.DisplayLanguage ?? s.Language ?? `Sub ${s.Index}`) as string;
}

export function filterTextSubtitles(
	config: ServiceConfig,
	itemId: string,
	mediaSourceId: string,
	streams: any[]
): TrackInfo[] {
	return streams
		.filter((s) => s.Type === 'Subtitle' && isTextSub(s))
		.map((s) => ({
			id: s.Index as number,
			name: subLabel(s),
			lang: (s.Language ?? '') as string,
			codec: s.Codec as string | undefined,
			isExternal: (s.IsExternal ?? false) as boolean,
			// Always request .vtt — Jellyfin converts SRT/ASS→WebVTT and <track>
			// only eats WebVTT. Prefer DeliveryUrl when external, else build the
			// canonical Stream.vtt path. Routed through the Nexus subtitle proxy.
			url: subtitleProxyUrl(config, itemId, mediaSourceId, s)
		}));
}

export function filterImageSubtitles(streams: any[]): TrackInfo[] {
	return streams
		.filter((s) => s.Type === 'Subtitle' && !isTextSub(s))
		.map((s) => ({
			id: s.Index as number,
			name: subLabel(s),
			lang: (s.Language ?? '') as string,
			codec: s.Codec as string | undefined,
			isExternal: (s.IsExternal ?? false) as boolean
		}));
}

export function filterAudioTracks(streams: any[]): TrackInfo[] {
	return streams
		.filter((s) => s.Type === 'Audio')
		.map((s) => ({
			id: s.Index as number,
			name: subLabel(s),
			lang: (s.Language ?? '') as string,
			codec: s.Codec as string | undefined
		}));
}

/** The .vtt subtitle URL through the Nexus subtitle proxy (browser never sees
 *  the Jellyfin origin or the cred). The route resolves the cred install-side. */
function subtitleProxyUrl(
	config: ServiceConfig,
	itemId: string,
	mediaSourceId: string,
	s: any
): string {
	const idx = s.Index as number;
	return `/api/subtitles/jellyfin?service=${encodeURIComponent(config.id)}&item=${encodeURIComponent(itemId)}&source=${encodeURIComponent(mediaSourceId)}&index=${idx}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DeviceProfile — PORTED from jellyfin-profile.ts, with the one real fix the
// live instance forced out: declare External SubtitleProfiles so Jellyfin
// side-loads text subs instead of BURNING them (which silently forces a
// transcode even on a direct-playable h264/aac file). See ADAPTER-BUILD-SPECS §4.
// ─────────────────────────────────────────────────────────────────────────────

export function buildDeviceProfile(caps: BrowserCaps, plan: PlaybackPlan) {
	const maxBitrate = plan.maxBitrate ?? 120_000_000;

	const canH264 = caps.videoCodecs.some((c) => c.startsWith('avc1'));
	const canHEVC = caps.videoCodecs.some((c) => c.startsWith('hev1') || c.startsWith('hvc1'));
	const canAV1 = caps.videoCodecs.some((c) => c.startsWith('av01'));
	const canVP9 = caps.videoCodecs.some((c) => c.startsWith('vp09') || c === 'vp9');
	const canVP8 = caps.videoCodecs.some((c) => c === 'vp8');

	const videoCodecList =
		[canH264 && 'h264', canHEVC && 'hevc', canAV1 && 'av1'].filter(Boolean).join(',') || 'h264';
	const webmVideoCodecList = [canVP8 && 'vp8', canVP9 && 'vp9', canAV1 && 'av1']
		.filter(Boolean)
		.join(',');

	const directPlayProfiles: any[] = [
		{ Container: 'mp4,m4v', Type: 'Video', VideoCodec: videoCodecList, AudioCodec: 'aac,mp3,ac3,eac3,opus' }
	];
	if (webmVideoCodecList) {
		directPlayProfiles.push({
			Container: 'webm',
			Type: 'Video',
			VideoCodec: webmVideoCodecList,
			AudioCodec: 'vorbis,opus'
		});
	}
	directPlayProfiles.push({
		Container: 'hls',
		Type: 'Video',
		VideoCodec: videoCodecList,
		AudioCodec: 'aac,mp3'
	});

	const transcodingProfiles: any[] = [
		{
			Container: 'mp4',
			Type: 'Video',
			Context: 'Streaming',
			Protocol: 'hls',
			VideoCodec: videoCodecList,
			AudioCodec: 'aac,mp3',
			MaxAudioChannels: '2',
			MinSegments: 1,
			BreakOnNonKeyFrames: true
		},
		{
			Container: 'ts',
			Type: 'Video',
			Context: 'Streaming',
			Protocol: 'hls',
			VideoCodec: canH264 ? 'h264' : videoCodecList,
			AudioCodec: 'aac,mp3',
			MaxAudioChannels: '2',
			MinSegments: 1,
			BreakOnNonKeyFrames: true
		}
	];

	return {
		Name: 'Nexus MSE Browser',
		MaxStreamingBitrate: maxBitrate,
		MaxStaticBitrate: 100_000_000,
		DirectPlayProfiles: directPlayProfiles,
		TranscodingProfiles: transcodingProfiles,
		ContainerProfiles: [],
		CodecProfiles: [],
		// External text-subtitle delivery: side-load VTT/SRT as <track>, never burn.
		SubtitleProfiles: [
			{ Format: 'vtt', Method: 'External' },
			{ Format: 'srt', Method: 'External' },
			{ Format: 'ass', Method: 'External' },
			{ Format: 'ssa', Method: 'External' }
		]
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Session metadata (pollSessions) — PORTED.
// ─────────────────────────────────────────────────────────────────────────────

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
	PlayState?: { PositionTicks?: number; IsPaused?: boolean; IsMuted?: boolean };
	TranscodingInfo?: { IsTranscoding?: boolean; Bitrate?: number; TranscodeReasons?: string[] };
}

const JF_SESSION_TYPE_MAP: Record<string, string> = {
	Movie: 'movie',
	Series: 'show',
	Episode: 'episode',
	Audio: 'music',
	MusicAlbum: 'album'
};

function extractSessionMetadata(session: JfSession): Record<string, unknown> {
	const meta: Record<string, unknown> = {};
	const item = session.NowPlayingItem;
	if (!item) return meta;

	const streams = (item.MediaStreams ?? []) as any[];
	const video = streams.find((s) => s.Type === 'Video');
	const audio = streams.find((s) => s.Type === 'Audio');
	const subtitle = streams.find((s) => s.Type === 'Subtitle');

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

// ─────────────────────────────────────────────────────────────────────────────
// negotiatePlayback — REBUILT: single service cred + grant handoff.
// ─────────────────────────────────────────────────────────────────────────────

/** Map a PlaybackInfo response → a Nexus PlaybackSession (upstream URL still
 *  raw here; the proxy handoff swaps it for a Nexus-origin grant URL). */
function buildSession(
	config: ServiceConfig,
	itemId: string,
	info: any
): PlaybackSession {
	const source = info.MediaSources?.[0];
	if (!source) throw new Error('No media sources returned from PlaybackInfo');

	const mode = derivePlaybackMode(source);
	const streams: any[] = source.MediaStreams ?? [];
	const playSessionId = info.PlaySessionId as string | undefined;
	const mediaSourceId = (source.Id ?? source.ItemId ?? itemId) as string;
	const videoStream = streams.find((s) => s.Type === 'Video');
	const sourceHeight = typeof videoStream?.Height === 'number' ? videoStream.Height : undefined;

	let upstreamUrl: string;
	if (source.TranscodingUrl) {
		// Verbatim — it bakes Jellyfin's decided plan (codec, bitrate, segments).
		upstreamUrl = `${baseUrl(config)}${source.TranscodingUrl}`;
	} else {
		// Direct-play: original bytes, zero ffmpeg.
		upstreamUrl = `${baseUrl(config)}/Videos/${mediaSourceId}/stream?static=true&mediaSourceId=${mediaSourceId}`;
		if (playSessionId) upstreamUrl += `&playSessionId=${playSessionId}`;
	}

	return {
		engine: source.TranscodingUrl ? 'hls' : 'progressive',
		kind: 'jellyfin',
		url: upstreamUrl,
		mode,
		playSessionId,
		mediaSourceId,
		audioTracks: filterAudioTracks(streams),
		subtitleTracks: filterTextSubtitles(config, itemId, mediaSourceId, streams),
		burnableSubtitleTracks: filterImageSubtitles(streams),
		sourceHeight
	};
}

async function negotiatePlayback(
	config: ServiceConfig,
	item: { id: string; type: string; title?: string },
	plan: PlaybackPlan,
	caps: BrowserCaps
): Promise<PlaybackSession> {
	const userId = await getUserId(config);

	const effectivePlan: PlaybackPlan = { ...plan };
	if (plan.targetHeight && !plan.maxBitrate) {
		effectivePlan.maxBitrate = PRESET_BITRATES[plan.targetHeight] ?? 8_000_000;
	}
	// Track/quality picks force a re-negotiation because Jellyfin bakes the
	// default audio/sub at negotiation and can't flip mid-stream.
	const forcingTranscode =
		!!plan.targetHeight ||
		!!plan.maxBitrate ||
		plan.burnSubIndex !== undefined ||
		plan.audioTrackHint !== undefined ||
		plan.subtitleTrackHint !== undefined;

	const profile = buildDeviceProfile(caps, effectivePlan);

	const body: Record<string, unknown> = {
		UserId: userId,
		DeviceProfile: profile,
		EnableDirectPlay: !forcingTranscode,
		EnableDirectStream: !forcingTranscode,
		EnableTranscoding: true,
		AllowVideoStreamCopy: !forcingTranscode,
		AllowAudioStreamCopy: !forcingTranscode,
		MaxAudioChannels: 2,
		AutoOpenLiveStream: true,
		// Default: zero burn-in. Side-loaded WebVTT, client-side toggle.
		SubtitleStreamIndex: -1
	};
	if (effectivePlan.maxBitrate) body.MaxStreamingBitrate = effectivePlan.maxBitrate;
	if (plan.startPositionSeconds) {
		body.StartTimeTicks = Math.round(plan.startPositionSeconds * 10_000_000);
	}
	// Burn-in opt-in only: SubtitleStreamIndex + explicit SubtitleMethod=Encode.
	if (plan.burnSubIndex !== undefined) {
		body.SubtitleStreamIndex = plan.burnSubIndex;
		body.SubtitleMethod = 'Encode';
	} else if (plan.subtitleTrackHint !== undefined) {
		body.SubtitleStreamIndex = plan.subtitleTrackHint;
	}
	if (plan.audioTrackHint !== undefined) body.AudioStreamIndex = plan.audioTrackHint;

	const res = await fetch(`${baseUrl(config)}/Items/${item.id}/PlaybackInfo`, {
		method: 'POST',
		headers: { ...authHeaders(config), 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`Jellyfin PlaybackInfo failed: ${res.status}`);
	const info = await res.json();
	if (info.ErrorCode) throw new Error(`Jellyfin PlaybackInfo error: ${info.ErrorCode}`);

	const session = buildSession(config, item.id, info);

	// Proxy handoff: mint a grant, hold the cred server-side, hand the browser a
	// Nexus-origin URL. The proxy strips ApiKey + rewrites HLS child URIs.
	const proxy = await createStreamSession({
		upstreamUrl: session.url,
		authHeaders: authHeaders(config),
		isHls: session.engine === 'hls',
		kind: 'jellyfin'
	});
	if (proxy) {
		session.url = proxy.streamUrl;
	}

	// changeQuality re-negotiates (close the prior transcode first to avoid orphans).
	session.changeQuality = async (newPlan: PlaybackPlan) => {
		await session.close?.();
		return negotiatePlayback(config, item, { ...plan, ...newPlan }, caps);
	};

	// close → report stopped + reap the transcode (best-effort).
	session.close = async () => {
		if (!session.playSessionId) return;
		try {
			await fetch(`${baseUrl(config)}/Sessions/Playing/Stopped`, {
				method: 'POST',
				headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
				body: JSON.stringify({
					ItemId: item.id,
					MediaSourceId: session.mediaSourceId,
					PlaySessionId: session.playSessionId
				}),
				signal: AbortSignal.timeout(5000)
			});
		} catch {
			/* best-effort */
		}
	};

	return session;
}

// ─────────────────────────────────────────────────────────────────────────────
// The adapter.
// ─────────────────────────────────────────────────────────────────────────────

export const jellyfinV2 = declareAdapter({
	id: 'jellyfin',
	displayName: 'Jellyfin',
	defaultPort: 8096,
	abbreviation: 'JF',
	color: '#a95dc9',
	icon: 'jellyfin',
	contractVersion: 2,
	tier: 'media-source',
	capabilities: {
		media: ['movie', 'show', 'music', 'live'],
		serviceAuth: { required: true, fields: ['url', 'apiKey'], kind: 'api-key' },
		library: true,
		search: { priority: 0 },
		playback: true,
		sessions: { pollIntervalMs: 10_000 }
	},

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			// /System/Info/Public is unauthenticated — fine for reachability/ping.
			const res = await fetch(`${baseUrl(config)}/System/Info/Public`, {
				signal: AbortSignal.timeout(5000)
			});
			if (!res.ok) throw new Error(`/System/Info/Public → ${res.status}`);
			// Warm the admin userId cache in the background.
			getUserId(config).catch(() => {});
			return {
				serviceId: config.id,
				name: config.name,
				type: 'jellyfin',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'jellyfin',
				online: false,
				error: String(e)
			};
		}
	},

	/** Install-level cred probe. /System/Info (NOT /System/Info/Public — that's
	 *  unauthenticated and would falsely report "ok" with a dead token). */
	async probeServiceCredential(config): Promise<CredentialProbeResult> {
		try {
			const res = await fetch(`${baseUrl(config)}/System/Info`, {
				headers: { ...authHeaders(config), Accept: 'application/json' },
				signal: AbortSignal.timeout(5000)
			});
			if (res.status === 401) return 'expired';
			if (res.status === 403) return 'invalid';
			if (!res.ok) return 'invalid';
			return 'ok';
		} catch {
			return 'invalid';
		}
	},

	async getImageHeaders(config) {
		return authHeaders(config);
	},

	async getLibrary(config, opts: LibraryQuery = {}): Promise<LibraryPage> {
		try {
			const userId = await getUserId(config);
			const typeMap: Record<string, string> = {
				movie: 'Movie',
				show: 'Series',
				music: 'Audio',
				album: 'MusicAlbum',
				episode: 'Episode'
			};
			const includeTypes = opts.type
				? (typeMap[opts.type] ?? 'Movie,Series,MusicAlbum')
				: 'Movie,Series,MusicAlbum';
			const sortMap: Record<string, string> = {
				title: 'SortName',
				year: 'ProductionYear',
				rating: 'CommunityRating',
				added: 'DateCreated'
			};
			const sortBy = sortMap[opts.sortBy ?? 'title'] ?? 'SortName';
			const data = await jfFetch(config, '/Items', {
				userId,
				IncludeItemTypes: includeTypes,
				Recursive: 'true',
				SortBy: sortBy,
				SortOrder: 'Ascending',
				Limit: String(opts.limit ?? 100),
				StartIndex: String(opts.offset ?? 0),
				Fields: FIELDS,
				EnableUserData: 'true',
				EnableImages: 'true'
			});
			return {
				items: (data.Items ?? []).map((i: unknown) => normalize(config, i)),
				total: data.TotalRecordCount ?? 0
			};
		} catch {
			return { items: [], total: 0 };
		}
	},

	async getRecentlyAdded(config): Promise<UnifiedMedia[]> {
		try {
			const userId = await getUserId(config);
			// /Items/Latest returns a BARE array, not {Items}.
			const data = await jfFetch(config, `/Users/${userId}/Items/Latest`, {
				Limit: '20',
				Fields: FIELDS,
				IncludeItemTypes: 'Movie,Series,MusicAlbum',
				EnableUserData: 'true',
				EnableImages: 'true'
			});
			return (Array.isArray(data) ? data : (data.Items ?? [])).map((i: unknown) =>
				normalize(config, i)
			);
		} catch {
			return [];
		}
	},

	async getItem(config, sourceId): Promise<UnifiedMedia | null> {
		try {
			const userId = await getUserId(config);
			const item = await jfFetch(config, `/Items/${sourceId}`, {
				userId,
				Fields: DETAIL_FIELDS
			});
			return normalize(config, item);
		} catch {
			return null;
		}
	},

	async search(config, query): Promise<UnifiedSearchResult> {
		try {
			const userId = await getUserId(config);
			const data = await jfFetch(config, '/Items', {
				userId,
				SearchTerm: query,
				IncludeItemTypes: 'Movie,Series,Episode,MusicAlbum,Audio',
				Recursive: 'true',
				Limit: '30',
				Fields: FIELDS,
				EnableUserData: 'true'
			});
			return {
				items: (data.Items ?? []).map((i: unknown) => normalize(config, i)),
				total: data.TotalRecordCount ?? 0,
				source: 'jellyfin'
			};
		} catch {
			return { items: [], total: 0, source: 'jellyfin' };
		}
	},

	async negotiatePlayback(config, item, plan, caps): Promise<PlaybackSession> {
		return negotiatePlayback(config, item, plan, caps);
	},

	async pollSessions(config): Promise<NexusSession[]> {
		const res = await fetch(`${baseUrl(config)}/Sessions`, {
			headers: { ...authHeaders(config), Accept: 'application/json' },
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) throw new Error(`Jellyfin /Sessions → ${res.status}`);
		const sessions: JfSession[] = await res.json();
		const results: NexusSession[] = [];
		for (const session of sessions) {
			if (!session.NowPlayingItem) continue;
			const item = session.NowPlayingItem;
			const isPaused = session.PlayState?.IsPaused ?? false;
			const mType = JF_SESSION_TYPE_MAP[item.Type] ?? 'movie';
			const positionTicks = session.PlayState?.PositionTicks;
			const runtimeTicks = item.RunTimeTicks;
			let progress = 0;
			if (positionTicks && runtimeTicks) progress = Math.min(1, positionTicks / runtimeTicks);
			results.push({
				sessionId: session.Id,
				userId: session.UserId,
				username: session.UserName,
				mediaId: item.Id,
				mediaTitle: item.Name,
				mediaType: mType as NexusSession['mediaType'],
				state: isPaused ? 'paused' : 'playing',
				progress,
				positionSeconds: positionTicks ? positionTicks / 10_000_000 : undefined,
				durationSeconds: runtimeTicks ? runtimeTicks / 10_000_000 : undefined,
				device: session.DeviceName,
				client: session.Client,
				year: item.ProductionYear,
				genres: item.Genres,
				parentId: item.SeriesId,
				parentTitle: item.SeriesName,
				metadata: extractSessionMetadata(session)
			});
		}
		return results;
	}
} satisfies NexusAdapter);

/** TEST-ONLY: clear the admin-userId cache so integration tests start clean. */
export function __clearUserIdCache() {
	userIdCache.clear();
}
