/**
 * Plex adapter — v2 (Nexus-owns-identity).
 *
 * ONE service credential (the install's X-Plex-Token) held by Nexus. No per-user
 * auth surface: every method takes `(config, …)`. The whole v1 identity spine —
 * UserCredential params, authenticateUser / getUsers / probeAdminCredential /
 * probeCredential / refreshCredential, userLinkable / adminAuth, the PIN flow —
 * is DELETED, not ported (Rule E bans it mechanically).
 *
 * Stream bytes never cross the browser→Plex boundary — `negotiatePlayback` mints
 * a grant the Rust proxy verifies while holding the cred, and the browser only
 * ever sees a Nexus-origin `/api/stream-proxy/...` URL. The handoff FAILS CLOSED:
 * no proxy URL ⇒ no playback (never expose the raw backend URL + X-Plex-Token).
 *
 * PORTED verbatim (certified mappers): the normalize/UnifiedMedia mapping, the
 * getLibrary section→items sweep, getItem / search / getRecentlyAdded, the
 * pollSessions mapping (incl. TranscodeSession→isTranscoding), and the playback
 * mappers (snapToPlexLadder, derivePlaybackMode, filter*Tracks, the transcode /
 * direct-stream URL builders, the hls.js retry tuning). The ONE image change:
 * URLs now route through Nexus's `/api/media/image` proxy exactly like
 * jellyfin.ts (no raw Plex origin / X-Plex-Token in the browser). The v1
 * `streamUrl` field is dropped — playback is grant-gated via negotiatePlayback.
 */

import type {
	NexusSession,
	ServiceConfig,
	ServiceHealth,
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
import { createStreamSession } from '../../server/stream-proxy';

// ─────────────────────────────────────────────────────────────────────────────
// Auth & fetch — REBUILT for the single service credential.
// ─────────────────────────────────────────────────────────────────────────────

/** The Plex auth headers, scoped to config.id so this install owns one client
 *  identity. ONE token, from the install service cred — never a per-user cred. */
function plexHeaders(config: ServiceConfig): Record<string, string> {
	return {
		'X-Plex-Token': config.apiKey ?? '',
		'X-Plex-Client-Identifier': `nexus-${config.id}`,
		'X-Plex-Product': 'Nexus',
		'X-Plex-Version': '1.0.0',
		Accept: 'application/json'
	};
}

function baseUrl(config: ServiceConfig): string {
	return config.url.replace(/\/+$/, '');
}

/** Single pxFetch — one cred, parses the Plex JSON MediaContainer envelope. */
async function pxFetch(
	config: ServiceConfig,
	path: string,
	params?: Record<string, string>,
	timeoutMs = 8000
): Promise<any> {
	const url = new URL(`${baseUrl(config)}${path}`);
	if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url.toString(), {
		headers: plexHeaders(config),
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`Plex ${path} → ${res.status}`);
	return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation — PORTED from v1 plex.ts; image URLs re-routed through the Nexus
// proxy (copied from jellyfin.ts proxyPath); v1 `streamUrl` dropped.
// ─────────────────────────────────────────────────────────────────────────────

function mediaType(plexType: string): UnifiedMedia['type'] {
	switch (plexType) {
		case 'movie':
			return 'movie';
		case 'show':
			return 'show';
		case 'episode':
			return 'episode';
		case 'artist':
			return 'music';
		case 'album':
			return 'album';
		case 'track':
			return 'music';
		default:
			return 'movie';
	}
}

/** Nexus image proxy path — copied from jellyfin.ts. The browser never sees the
 *  Plex origin or X-Plex-Token; the route forwards getImageHeaders server-side. */
function proxyPath(config: ServiceConfig, path: string): string {
	return `/api/media/image?service=${encodeURIComponent(config.id)}&path=${encodeURIComponent(path)}`;
}

function imageUrl(config: ServiceConfig, path: string | undefined): string | undefined {
	if (!path) return undefined;
	return proxyPath(config, path);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(config: ServiceConfig, item: any): UnifiedMedia {
	const type = mediaType(item.type);

	// Progress from viewOffset / duration (both in ms).
	let progress: number | undefined;
	if (item.viewOffset && item.duration) {
		progress = Math.min(1, item.viewOffset / item.duration);
	}

	// Cast from the Role array.
	const cast: Array<{ name: string; role: string; type: string; imageUrl?: string }> = [];
	if (Array.isArray(item.Role)) {
		for (const r of item.Role) {
			cast.push({
				name: r.tag ?? '',
				role: r.role ?? '',
				type: 'Actor',
				imageUrl: r.thumb ? imageUrl(config, r.thumb) : undefined
			});
		}
	}

	// Plex `Guid` array carries external IDs (tmdb://, imdb://, tvdb://) — used
	// downstream for Bazarr/Overseerr/etc. cross-service resolution.
	const providerIds: Record<string, string> = {};
	let tmdbId: string | null = null;
	let imdbId: string | null = null;
	if (Array.isArray(item.Guid)) {
		for (const g of item.Guid) {
			const id = String(g.id ?? '');
			if (id.startsWith('tmdb://')) {
				tmdbId = id.slice('tmdb://'.length);
				providerIds.Tmdb = tmdbId;
			} else if (id.startsWith('imdb://')) {
				imdbId = id.slice('imdb://'.length);
				providerIds.Imdb = imdbId;
			} else if (id.startsWith('tvdb://')) {
				providerIds.Tvdb = id.slice('tvdb://'.length);
			}
		}
	}

	return {
		id: `${item.ratingKey}:${config.id}`,
		sourceId: String(item.ratingKey),
		serviceId: config.id,
		serviceType: 'plex',
		type,
		title: item.title ?? 'Unknown',
		sortTitle: item.titleSort,
		description: item.summary,
		poster: imageUrl(config, item.thumb),
		backdrop: imageUrl(config, item.art),
		year: item.year,
		rating: item.rating,
		genres: item.Genre?.map((g: { tag: string }) => g.tag) ?? [],
		studios: item.Studio ? [item.Studio] : [],
		duration: item.duration ? Math.round(item.duration / 1000) : undefined,
		status: 'available',
		progress,
		metadata: {
			plexRatingKey: item.ratingKey,
			cast,
			seriesId: item.grandparentRatingKey ? String(item.grandparentRatingKey) : undefined,
			seriesName: item.grandparentTitle,
			seasonNumber: item.parentIndex,
			episodeNumber: item.index,
			episodeTitle: item.type === 'episode' ? item.title : undefined,
			contentRating: item.contentRating,
			officialRating: item.contentRating,
			criticRating: item.rating,
			taglines: item.tagline ? [item.tagline] : [],
			tmdbId,
			imdbId,
			providerIds,
			// Music-specific.
			artist: item.grandparentTitle ?? item.parentTitle,
			artistId: item.grandparentRatingKey ? String(item.grandparentRatingKey) : undefined,
			albumId: item.parentRatingKey ? String(item.parentRatingKey) : undefined,
			albumName: item.parentTitle,
			trackNumber: item.index
		},
		actionLabel: type === 'music' || type === 'album' ? 'Listen' : 'Watch',
		actionUrl: `${baseUrl(config)}/web/index.html#!/server/${config.id}/details?key=${encodeURIComponent(`/library/metadata/${item.ratingKey}`)}`
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Session helpers — PORTED.
// ─────────────────────────────────────────────────────────────────────────────

const PLEX_SESSION_TYPE_MAP: Record<string, string> = {
	movie: 'movie',
	episode: 'episode',
	track: 'music',
	clip: 'movie'
};

// ─────────────────────────────────────────────────────────────────────────────
// Playback mappers — PORTED from v1 plex-playback.ts (logic certified).
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_SUB_CODECS = new Set(['pgs', 'pgssub', 'vobsub', 'dvdsub', 'dvbsub']);

const PLEX_CLIENT_ID_PREFIX = 'nexus';

/**
 * Plex's universal transcoder rejects arbitrary resolution values with a 400 —
 * `videoResolution=1920x1912` (a raw retina `screen.height * dpr`) fails where
 * `1920x1080` succeeds. Snap to the nearest standard HLS ladder rung at or below
 * the input so we always request a height Plex will honor.
 */
const PLEX_HLS_LADDER = [2160, 1440, 1080, 720, 480] as const;
export function snapToPlexLadder(height: number): number {
	return PLEX_HLS_LADDER.find((h) => h <= height) ?? 480;
}

/** Derive Nexus playback mode from a Plex decision / part response. */
export function derivePlaybackMode(decision: {
	generalDecisionCode?: number;
	generalDecisionText?: string;
	mediaDecision?: string;
	videoDecision?: string;
	audioDecision?: string;
}): PlaybackMode {
	const v = (decision.videoDecision ?? decision.mediaDecision ?? '').toLowerCase();
	if (v === 'copy' || v === 'directstream' || v === 'direct stream') return 'direct-stream';
	if (v === 'transcode') return 'transcode';
	// Default to direct-play — Plex considers "no transcode needed" to mean direct-play.
	return 'direct-play';
}

export function filterAudioTracks(streams: any[]): TrackInfo[] {
	return streams
		.filter((s) => s.streamType === 2)
		.map((s, idx) => ({
			id: Number(s.id ?? idx),
			name: (s.displayTitle ?? s.extendedDisplayTitle ?? s.language ?? `Audio ${idx}`) as string,
			lang: (s.languageCode ?? s.language ?? '') as string,
			codec: s.codec as string | undefined
		}));
}

export function filterTextSubtitles(streams: any[]): TrackInfo[] {
	return streams
		.filter((s) => s.streamType === 3)
		.filter((s) => !IMAGE_SUB_CODECS.has(String(s.codec ?? '').toLowerCase()))
		.map((s, idx) => ({
			id: Number(s.id ?? idx),
			name: (s.displayTitle ?? s.extendedDisplayTitle ?? s.language ?? `Sub ${idx}`) as string,
			lang: (s.languageCode ?? s.language ?? '') as string,
			codec: s.codec as string | undefined,
			isExternal: s.key ? true : false
		}));
}

export function filterImageSubtitles(streams: any[]): TrackInfo[] {
	return streams
		.filter((s) => s.streamType === 3)
		.filter((s) => IMAGE_SUB_CODECS.has(String(s.codec ?? '').toLowerCase()))
		.map((s, idx) => ({
			id: Number(s.id ?? idx),
			name: (s.displayTitle ?? s.extendedDisplayTitle ?? s.language ?? `Sub ${idx}`) as string,
			lang: (s.languageCode ?? s.language ?? '') as string,
			codec: s.codec as string | undefined,
			isExternal: s.key ? true : false
		}));
}

/** Fetch the raw metadata for an item, including its Media[] / Part[] / Stream[] tree. */
async function fetchMetadata(config: ServiceConfig, itemId: string): Promise<any> {
	const data = await pxFetch(config, `/library/metadata/${itemId}`, undefined, 10_000);
	const meta = data?.MediaContainer?.Metadata?.[0];
	if (!meta) throw new Error('Plex: no metadata returned');
	return meta;
}

/**
 * Build a Plex `/video/:/transcode/universal/start.m3u8` URL for HLS transcode.
 *
 * `measuredBandwidthBps` is threaded in as a SOFT cap when no explicit bitrate
 * was picked: it sets maxVideoBitrate without otherwise forcing a transcode.
 * Kept server-side so the X-Plex-Token isn't visible to the client; the URL is
 * subsequently wrapped by the Rust stream-proxy.
 */
function buildTranscodeUrl(
	config: ServiceConfig,
	item: { id: string; key?: string },
	plan: PlaybackPlan,
	caps: BrowserCaps,
	sessionId: string
): string {
	const base = baseUrl(config);
	// `path` must be the library metadata URI, e.g. `/library/metadata/12345`.
	const path = item.key ?? `/library/metadata/${item.id}`;
	const rawHeight = plan.targetHeight ?? caps.maxHeight ?? 1080;
	const maxHeight = snapToPlexLadder(rawHeight);
	// kbps for Plex. Explicit pick wins; else the measured-bandwidth soft cap; else default.
	const maxBitrate = plan.maxBitrate
		? Math.round(plan.maxBitrate / 1000)
		: plan.measuredBandwidthBps && plan.measuredBandwidthBps > 0
			? Math.round((plan.measuredBandwidthBps * 0.85) / 1000)
			: 20_000;

	const params = new URLSearchParams();
	params.set('path', path);
	params.set('mediaIndex', '0');
	params.set('partIndex', '0');
	params.set('protocol', 'hls');
	params.set('fastSeek', '1');
	params.set('directPlay', '0');
	params.set('directStream', '1');
	params.set('subtitleSize', '100');
	params.set('audioBoost', '100');
	params.set('session', sessionId);
	params.set('maxVideoBitrate', String(maxBitrate));
	params.set('videoResolution', `1920x${maxHeight}`);
	params.set('videoQuality', '100');
	// Plex generates TS segments lazily behind the playhead — without this flag a
	// client request for segment N returns 404 when Plex hasn't emitted it yet.
	params.set('waitForSegments', '1');
	params.set('X-Plex-Token', config.apiKey ?? '');
	params.set('X-Plex-Client-Identifier', `${PLEX_CLIENT_ID_PREFIX}-${config.id}`);
	params.set('X-Plex-Product', 'Nexus');
	params.set('X-Plex-Version', '1.0.0');
	params.set('X-Plex-Platform', 'Web');
	params.set('X-Plex-Client-Profile-Name', 'Chrome');
	params.set('X-Plex-Session-Identifier', sessionId);
	// Reasonable default codec set — Plex honors what the browser can decode.
	const canH264 = caps.videoCodecs.some((c) => c.startsWith('avc1'));
	const canHEVC = caps.videoCodecs.some((c) => c.startsWith('hev1') || c.startsWith('hvc1'));
	const videoCodecs = [canH264 && 'h264', canHEVC && 'hevc'].filter(Boolean).join(',') || 'h264';
	params.set('protocolOptions', JSON.stringify({ Video: { Codec: videoCodecs } }));
	if (plan.startPositionSeconds) {
		params.set('offset', String(Math.round(plan.startPositionSeconds)));
	}
	if (plan.burnSubIndex !== undefined) {
		params.set('subtitles', 'burn');
		params.set('subtitleStreamID', String(plan.burnSubIndex));
	}
	return `${base}/video/:/transcode/universal/start.m3u8?${params.toString()}`;
}

/** Build a direct-play stream URL for a given Part. */
function buildDirectStreamUrl(config: ServiceConfig, part: { key: string }): string {
	const base = baseUrl(config);
	const sep = part.key.includes('?') ? '&' : '?';
	return `${base}${part.key}${sep}X-Plex-Token=${encodeURIComponent(config.apiKey ?? '')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// negotiatePlayback — REBUILT: single service cred + grant handoff (mirrors
// jellyfin.ts: direct-play-first, measuredBandwidth SOFT cap, FAIL CLOSED).
// ─────────────────────────────────────────────────────────────────────────────

async function negotiatePlayback(
	config: ServiceConfig,
	item: { id: string; type: string; title?: string },
	plan: PlaybackPlan,
	caps: BrowserCaps,
	ctx?: { nexusUserId?: string }
): Promise<PlaybackSession> {
	const meta = await fetchMetadata(config, item.id);
	const media = meta?.Media?.[0];
	const part = media?.Part?.[0];
	if (!media || !part) throw new Error('Plex: item has no playable Media/Part');

	// Defensive: Plex-supplied keys are interpolated into the upstream URL before
	// the proxy sees it (buildDirectStreamUrl = base + part.key). Require a
	// server-relative path so a compromised/hostile PMS can't shift the host.
	if (part.key && (!part.key.startsWith('/') || part.key.includes('://') || part.key.includes('@'))) {
		throw new Error('Plex: refusing non-relative part key');
	}

	const streams: any[] = part.Stream ?? [];
	const videoStream = streams.find((s) => s.streamType === 1);
	const sourceHeight = typeof videoStream?.height === 'number' ? videoStream.height : undefined;

	// EXPLICIT quality/track picks force a transcode. measuredBandwidthBps is a
	// SOFT cap (deliberately NOT here): it caps maxVideoBitrate while the decision
	// keeps directPlay=1, so a fitting source still direct-plays.
	const forcingTranscode =
		!!plan.targetHeight ||
		!!plan.maxBitrate ||
		plan.burnSubIndex !== undefined ||
		plan.audioTrackHint !== undefined ||
		plan.subtitleTrackHint !== undefined;

	// Client-capability gate. Plex's named "Chrome" profile is permissive (it
	// green-lights HEVC direct-play), so the decision alone can't be trusted — we
	// must gate on what THIS client can actually decode. If the source video codec
	// isn't in the browser's caps, force a transcode. (avc1*→h264, hev1*/hvc1*→hevc;
	// bare 'h264'/'hevc' also accepted for non-MSE callers.)
	const sourceVideoCodec = (videoStream?.codec ?? '').toLowerCase();
	const canH264 = caps.videoCodecs.some((c) => c.startsWith('avc1') || c === 'h264');
	const canHEVC = caps.videoCodecs.some(
		(c) => c.startsWith('hev1') || c.startsWith('hvc1') || c === 'hevc'
	);
	const clientCanPlayVideo =
		sourceVideoCodec === 'h264'
			? canH264
			: sourceVideoCodec === 'hevc' || sourceVideoCodec === 'h265'
				? canHEVC
				: true; // unknown/other codec → defer to Plex's decision
	// Audio + container must ALSO be browser-decodable — otherwise direct-play
	// hands the <video> element a stream it can't render (silent failure, no
	// fallback). Map Plex's audio codec name to the browser's caps.audioCodecs, and
	// require a progressively-playable container; anything else forces transcode.
	const audioStream = streams.find((s) => s.streamType === 2);
	const sourceAudioCodec = (audioStream?.codec ?? '').toLowerCase();
	const sourceContainer = (part.container ?? media.container ?? '').toLowerCase();
	const audioHas = (frag: string) => caps.audioCodecs.some((a) => a.toLowerCase().includes(frag));
	const clientCanPlayAudio =
		!sourceAudioCodec ||
		(sourceAudioCodec === 'aac'
			? audioHas('mp4a') || audioHas('aac')
			: sourceAudioCodec === 'mp3'
				? audioHas('mp3') || audioHas('mp4a.40.34')
				: sourceAudioCodec === 'opus'
					? audioHas('opus')
					: sourceAudioCodec === 'flac'
						? audioHas('flac')
						: sourceAudioCodec === 'vorbis'
							? audioHas('vorbis')
							: sourceAudioCodec === 'ac3'
								? audioHas('ac-3') || audioHas('ac3')
								: sourceAudioCodec === 'eac3'
									? audioHas('ec-3') || audioHas('eac3')
									: false); // dts/truehd/pcm/… → not browser-decodable
	const PROGRESSIVE_CONTAINERS = ['mp4', 'm4v', 'mov', 'webm'];
	const clientCanPlayContainer =
		!sourceContainer ||
		PROGRESSIVE_CONTAINERS.includes(sourceContainer) ||
		caps.containers.some((c) => c.toLowerCase() === sourceContainer);
	const mustTranscode =
		forcingTranscode || !clientCanPlayVideo || !clientCanPlayAudio || !clientCanPlayContainer;

	// A session identifier ties HLS segment requests back to a server-side
	// transcode session so we can later call /transcode/universal/stop.
	const sessionId = `nexus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

	// Ask Plex for a playback decision. directPlay stays 1 unless an explicit pick
	// forces a transcode — the measured-bandwidth soft cap still allows direct-play.
	const decisionMaxBitrate = plan.maxBitrate
		? Math.round(plan.maxBitrate / 1000)
		: plan.measuredBandwidthBps && plan.measuredBandwidthBps > 0
			? Math.round((plan.measuredBandwidthBps * 0.85) / 1000)
			: 20_000;
	const decisionHeight = snapToPlexLadder(plan.targetHeight ?? caps.maxHeight ?? 1080);
	const decisionParams: Record<string, string> = {
		path: `/library/metadata/${item.id}`,
		mediaIndex: '0',
		partIndex: '0',
		protocol: 'hls',
		hasMDE: '1',
		directPlay: mustTranscode ? '0' : '1',
		directStream: '1',
		maxVideoBitrate: String(decisionMaxBitrate),
		videoResolution: `1920x${decisionHeight}`,
		session: sessionId,
		'X-Plex-Session-Identifier': sessionId,
		'X-Plex-Client-Profile-Name': 'Chrome'
	};

	let mode: PlaybackMode;
	try {
		const decisionData = await pxFetch(
			config,
			'/video/:/transcode/universal/decision',
			decisionParams,
			10_000
		);
		const dmeta = decisionData?.MediaContainer?.Metadata?.[0];
		const dpart = dmeta?.Media?.[0]?.Part?.[0];
		mode = derivePlaybackMode({
			generalDecisionCode: decisionData?.MediaContainer?.generalDecisionCode,
			generalDecisionText: decisionData?.MediaContainer?.generalDecisionText,
			videoDecision: dpart?.decision ?? dpart?.Stream?.find?.((s: any) => s.streamType === 1)?.decision,
			audioDecision: dpart?.Stream?.find?.((s: any) => s.streamType === 2)?.decision
		});
		if (mustTranscode) mode = 'transcode';
	} catch {
		// Decision endpoint unreachable / errored — fall back to the explicit plan.
		mode = mustTranscode ? 'transcode' : 'direct-play';
	}

	let upstreamUrl: string;
	let engine: 'hls' | 'progressive';
	if (mode === 'direct-play') {
		upstreamUrl = buildDirectStreamUrl(config, { key: part.key });
		engine = 'progressive';
	} else {
		// transcode OR direct-stream → Plex's universal HLS transcode endpoint.
		upstreamUrl = buildTranscodeUrl(config, { id: item.id, key: meta.key }, plan, caps, sessionId);
		engine = 'hls';
	}

	const session: PlaybackSession = {
		engine,
		kind: 'plex',
		url: upstreamUrl,
		mode,
		playSessionId: sessionId,
		mediaSourceId: String(media.id ?? part.id ?? item.id),
		audioTracks: filterAudioTracks(streams),
		subtitleTracks: filterTextSubtitles(streams),
		burnableSubtitleTracks: filterImageSubtitles(streams),
		sourceHeight,
		// Plex-specific hls.js tuning, scoped to this session so everything else
		// keeps hls.js's defaults:
		//  - Plex's transcoder lazily 404s segments not yet emitted; crank
		//    fragLoadingMaxRetry so routine "wait a moment" 404s don't stall.
		//  - Plex occasionally 400s the first /start.m3u8 while its metadata probe
		//    races session creation; retries get us past the cold start.
		hlsConfig:
			engine === 'hls'
				? {
						fragLoadingMaxRetry: 8,
						fragLoadingRetryDelay: 500,
						manifestLoadingMaxRetry: 4,
						manifestLoadingRetryDelay: 800,
						levelLoadingMaxRetry: 4,
						levelLoadingRetryDelay: 800
					}
				: undefined
	};

	// Proxy handoff: mint a grant, hold the cred server-side, hand the browser a
	// Nexus-origin URL. `kind: 'plex'` tells the proxy to apply Plex-specific
	// quirks (VOD-normalize the live-style manifest, enforce waitForSegments=1).
	const proxy = await createStreamSession({
		upstreamUrl: session.url,
		authHeaders: plexHeaders(config),
		isHls: session.engine === 'hls',
		kind: 'plex',
		userId: ctx?.nexusUserId
	});
	// FAIL CLOSED. If the handoff fails we must NOT fall back to `session.url` —
	// that's the raw backend URL (origin + X-Plex-Token), which would bypass the
	// grant proxy and leak the credential. No proxy URL ⇒ no playback.
	if (!proxy) {
		throw new Error(
			'stream proxy handoff failed (fail-closed: refusing to expose the raw backend URL)'
		);
	}
	session.url = proxy.streamUrl;

	// changeQuality re-negotiates (close the prior transcode first to avoid orphans).
	session.changeQuality = async (newPlan: PlaybackPlan) => {
		await session.close?.();
		return negotiatePlayback(config, item, { ...plan, ...newPlan }, caps, ctx);
	};

	// close → tell Plex to tear down the transcode session (no-op for direct-play).
	session.close = async () => {
		if (mode === 'direct-play') return;
		await fetch(
			`${baseUrl(config)}/video/:/transcode/universal/stop?session=${encodeURIComponent(sessionId)}`,
			{
				headers: plexHeaders(config),
				signal: AbortSignal.timeout(5000)
			}
		).catch(() => {});
	};

	return session;
}

// ─────────────────────────────────────────────────────────────────────────────
// The adapter.
// ─────────────────────────────────────────────────────────────────────────────

export const plexV2 = declareAdapter({
	id: 'plex',
	displayName: 'Plex',
	defaultPort: 32400,
	abbreviation: 'PX',
	color: '#e5a00d',
	icon: 'plex',
	contractVersion: 2,
	tier: 'media-source',
	capabilities: {
		media: ['movie', 'show', 'music'],
		serviceAuth: { required: true, fields: ['url', 'apiKey'], kind: 'api-key' },
		library: true,
		search: { priority: 0 },
		playback: true,
		sessions: { pollIntervalMs: 10_000 }
	},

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			const data = await pxFetch(config, '/');
			const serverName = data?.MediaContainer?.friendlyName ?? config.name;
			return {
				serviceId: config.id,
				name: serverName,
				type: 'plex',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'plex',
				online: false,
				error: String(e)
			};
		}
	},

	/** Install-level cred probe. GET / with the token: 401⇒expired, !ok⇒invalid. */
	async probeServiceCredential(config): Promise<CredentialProbeResult> {
		try {
			const res = await fetch(`${baseUrl(config)}/`, {
				headers: plexHeaders(config),
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
		return { 'X-Plex-Token': config.apiKey ?? '' };
	},

	async getLibrary(config, opts: LibraryQuery = {}): Promise<LibraryPage> {
		try {
			// First, get all library sections.
			const sections = await pxFetch(config, '/library/sections');
			const dirs = sections?.MediaContainer?.Directory ?? [];

			// If a type filter is given, map to Plex section types.
			const typeMap: Record<string, string> = {
				movie: 'movie',
				show: 'show',
				music: 'artist'
			};
			const wantedType = opts.type ? typeMap[opts.type] : undefined;

			const filteredDirs = wantedType
				? dirs.filter((d: { type: string }) => d.type === wantedType)
				: dirs;

			if (filteredDirs.length === 0) return { items: [], total: 0 };

			const allItems: UnifiedMedia[] = [];
			let totalCount = 0;

			for (const dir of filteredDirs) {
				const params: Record<string, string> = {
					'X-Plex-Container-Start': String(opts.offset ?? 0),
					'X-Plex-Container-Size': String(opts.limit ?? 50)
				};
				const data = await pxFetch(config, `/library/sections/${dir.key}/all`, params);
				const container = data?.MediaContainer ?? {};
				const items = container.Metadata ?? [];
				totalCount += container.totalSize ?? items.length;
				allItems.push(...items.map((i: unknown) => normalize(config, i)));

				if (allItems.length >= (opts.limit ?? 50)) break;
			}

			return {
				items: allItems.slice(0, opts.limit ?? 50),
				total: totalCount
			};
		} catch {
			return { items: [], total: 0 };
		}
	},

	async getRecentlyAdded(config): Promise<UnifiedMedia[]> {
		try {
			const data = await pxFetch(config, '/library/recentlyAdded');
			const items = data?.MediaContainer?.Metadata ?? [];
			return items.map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	async getItem(config, sourceId): Promise<UnifiedMedia | null> {
		try {
			const data = await pxFetch(config, `/library/metadata/${sourceId}`);
			const item = data?.MediaContainer?.Metadata?.[0];
			if (!item) return null;
			return normalize(config, item);
		} catch {
			return null;
		}
	},

	async search(config, query): Promise<UnifiedSearchResult> {
		try {
			const data = await pxFetch(config, '/search', { query });
			const items = data?.MediaContainer?.Metadata ?? [];
			return {
				items: items.map((i: unknown) => normalize(config, i)),
				total: items.length,
				source: 'plex'
			};
		} catch {
			return { items: [], total: 0, source: 'plex' };
		}
	},

	async negotiatePlayback(config, item, plan, caps, ctx): Promise<PlaybackSession> {
		return negotiatePlayback(config, item, plan, caps, ctx);
	},

	async pollSessions(config): Promise<NexusSession[]> {
		try {
			const data = await pxFetch(config, '/status/sessions', undefined, 5000);
			const sessions = data?.MediaContainer?.Metadata ?? [];
			const results: NexusSession[] = [];

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			for (const session of sessions as any[]) {
				if (!session.ratingKey) continue;

				const isPaused = session.Player?.state === 'paused';
				const mType = PLEX_SESSION_TYPE_MAP[session.type] ?? 'movie';
				const positionMs = session.viewOffset ?? 0;
				const durationMs = session.duration ?? 0;
				const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

				// For episodes, prefer the show-level art (grandparentArt) over the
				// episode's own still so the admin backdrop matches Jellyfin's behavior.
				const backdropPath = session.grandparentArt ?? session.art;
				const posterPath = session.grandparentThumb ?? session.thumb;

				results.push({
					sessionId: session.Session?.id ?? session.sessionKey ?? session.ratingKey,
					userId: session.User?.id ?? '',
					username: session.User?.title ?? 'Unknown',
					mediaId: String(session.ratingKey),
					mediaTitle: session.title,
					mediaType: mType as NexusSession['mediaType'],
					state: isPaused ? 'paused' : 'playing',
					progress,
					positionSeconds: positionMs > 0 ? positionMs / 1000 : undefined,
					durationSeconds: durationMs > 0 ? durationMs / 1000 : undefined,
					device: session.Player?.device ?? session.Player?.title,
					client: session.Player?.product,
					year: session.year,
					genres: session.Genre?.map((g: { tag: string }) => g.tag),
					parentId: session.grandparentRatingKey,
					parentTitle: session.grandparentTitle,
					metadata: {
						streamType: session.TranscodeSession ? 'transcode' : 'direct-play',
						isTranscoding: !!session.TranscodeSession,
						videoCodec: session.Media?.[0]?.videoCodec,
						audioCodec: session.Media?.[0]?.audioCodec,
						resolution: session.Media?.[0]?.videoResolution,
						bitrate: session.Media?.[0]?.bitrate,
						// Pre-resolved image URLs (routed through /api/media/image so the
						// browser never sees X-Plex-Token).
						backdropUrl: imageUrl(config, backdropPath),
						posterUrl: imageUrl(config, posterPath)
					}
				});
			}

			return results;
		} catch {
			return [];
		}
	}
} satisfies NexusAdapter);
