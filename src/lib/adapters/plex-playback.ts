import type { ServiceConfig, UserCredential } from './types';
import type { PlaybackPlan, PlaybackSession, BrowserCaps, PlaybackMode, TrackInfo } from './playback';
import { createStreamSession } from '$lib/server/stream-proxy';

/**
 * Plex playback negotiation.
 *
 * Parity goals with the Jellyfin path:
 *   - Ask the server for a playback decision (direct-play vs direct-stream vs transcode)
 *   - Expose audio/subtitle tracks so the player can surface a language menu
 *   - Wire up `changeQuality` so the quality menu can re-negotiate (forced height / bitrate cap)
 *   - Route the resulting URL through the Rust stream-proxy (X-Plex-Token stripping + byte pipe)
 *
 * Plex endpoint summary:
 *   /video/:/transcode/universal/decision   — ask "can this be direct-played?"
 *   /video/:/transcode/universal/start.m3u8 — HLS transcode stream
 *   /library/parts/{partId}/{indexKey}/file.{ext}?download=0 — direct-play stream
 *   /video/:/transcode/universal/stop       — stop a transcode session
 *
 * All requests require X-Plex-Token (and conventionally X-Plex-Client-Identifier).
 */

const IMAGE_SUB_CODECS = new Set(['pgs', 'pgssub', 'vobsub', 'dvdsub', 'dvbsub']);

/**
 * Plex's universal transcoder rejects arbitrary resolution values with a 400
 * — asking for `videoResolution=1920x1912` (what you get from a raw retina
 * `screen.height * dpr`) fails where `1920x1080` succeeds. Snap to the
 * nearest standard HLS ladder rung at or below the input, so we always
 * request a height Plex will honor. Kept inside the Plex adapter so other
 * adapters (Jellyfin caps via DeviceProfile) aren't constrained by it.
 */
const PLEX_HLS_LADDER = [2160, 1440, 1080, 720, 480] as const;
export function snapToPlexLadder(height: number): number {
	return PLEX_HLS_LADDER.find((h) => h <= height) ?? 480;
}

// ── Exported helpers ───────────────────────────────────────────────────

/** Derive Nexus playback mode from a Plex MediaContainer decision response. */
export function derivePlaybackMode(decision: {
	generalDecisionCode?: number;
	generalDecisionText?: string;
	mediaDecision?: string;
	videoDecision?: string;
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

// ── Main entry point ───────────────────────────────────────────────────

const PLEX_CLIENT_ID = 'nexus';

function plexHeaders(token: string): Record<string, string> {
	return {
		'X-Plex-Token': token,
		'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
		'X-Plex-Product': 'Nexus',
		'X-Plex-Version': '1.0.0',
		'X-Plex-Platform': 'Web',
		Accept: 'application/json'
	};
}

/** Fetch the raw metadata for an item, including its Media[] / Part[] / Stream[] tree. */
async function fetchMetadata(config: ServiceConfig, itemId: string, token: string) {
	const base = config.url.replace(/\/+$/, '');
	const res = await fetch(`${base}/library/metadata/${itemId}`, {
		headers: plexHeaders(token),
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) {
		throw new Error(`Plex metadata failed: ${res.status}`);
	}
	const data = await res.json();
	const meta = data?.MediaContainer?.Metadata?.[0];
	if (!meta) throw new Error('Plex: no metadata returned');
	return meta;
}

/**
 * Build a Plex `/video/:/transcode/universal/start.m3u8` URL for HLS transcoding.
 *
 * Plex's universal transcoder takes a gargantuan query string — we keep it
 * minimal and server-side so the X-Plex-Token isn't visible to the client.
 * The URL is subsequently wrapped by the Rust stream-proxy.
 */
function buildTranscodeUrl(
	config: ServiceConfig,
	token: string,
	item: { id: string; key?: string },
	plan: PlaybackPlan,
	caps: BrowserCaps,
	sessionId: string
): string {
	const base = config.url.replace(/\/+$/, '');
	// `path` must be the library metadata URI, e.g. `/library/metadata/12345`
	const path = item.key ?? `/library/metadata/${item.id}`;
	// Plex's transcoder 400s on non-ladder resolutions — a raw retina value
	// like 1912 fails. Snap down to the nearest standard HLS ladder rung so
	// we never ask Plex to transcode to a height it refuses to emit.
	const rawHeight = plan.targetHeight ?? caps.maxHeight ?? 1080;
	const maxHeight = snapToPlexLadder(rawHeight);
	const maxBitrate = plan.maxBitrate
		? Math.round(plan.maxBitrate / 1000) // kbps for Plex
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
	// Plex generates TS segments lazily behind the playhead — without this
	// flag, a client request for segment N returns 404 when Plex hasn't
	// emitted it yet. With waitForSegments=1 the server blocks the request
	// until the segment exists. Plex Web / Plexamp both set this.
	params.set('waitForSegments', '1');
	params.set('X-Plex-Token', token);
	params.set('X-Plex-Client-Identifier', PLEX_CLIENT_ID);
	params.set('X-Plex-Product', 'Nexus');
	params.set('X-Plex-Version', '1.0.0');
	params.set('X-Plex-Platform', 'Web');
	params.set('X-Plex-Session-Identifier', sessionId);
	// Reasonable default codec set — Plex will honor what the browser can decode.
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
function buildDirectStreamUrl(
	config: ServiceConfig,
	token: string,
	part: { key: string }
): string {
	const base = config.url.replace(/\/+$/, '');
	const sep = part.key.includes('?') ? '&' : '?';
	return `${base}${part.key}${sep}X-Plex-Token=${encodeURIComponent(token)}`;
}

export async function plexNegotiatePlayback(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	item: { id: string; type: string; title?: string },
	plan: PlaybackPlan,
	caps: BrowserCaps
): Promise<PlaybackSession> {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	if (!token) throw new Error('Plex: missing access token');

	const meta = await fetchMetadata(config, item.id, token);
	const media = meta?.Media?.[0];
	const part = media?.Part?.[0];
	if (!media || !part) throw new Error('Plex: item has no playable Media/Part');

	const streams: any[] = part.Stream ?? [];
	const videoStream = streams.find((s) => s.streamType === 1);
	const sourceHeight = typeof videoStream?.height === 'number' ? videoStream.height : undefined;

	// Decide whether we should direct-play or transcode.
	// If the user forced a height / bitrate / burn-sub we always transcode.
	const forcingTranscode =
		!!plan.targetHeight || !!plan.maxBitrate || plan.burnSubIndex !== undefined;

	// A session identifier ties HLS segment requests back to a server-side
	// transcode session so we can later call /transcode/universal/stop.
	const sessionId = `nexus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

	let streamUrl: string;
	let mode: PlaybackMode;
	let engine: 'hls' | 'progressive';

	if (forcingTranscode) {
		streamUrl = buildTranscodeUrl(config, token, { id: item.id, key: meta.key }, plan, caps, sessionId);
		mode = 'transcode';
		engine = 'hls';
	} else {
		// Direct stream — Plex understands this container natively; browser may not.
		// For full parity with Jellyfin's behavior we could probe with /decision,
		// but direct-play is the common fast-path and works for MP4+H.264+AAC.
		streamUrl = buildDirectStreamUrl(config, token, { key: part.key });
		mode = 'direct-play';
		engine = 'progressive';
	}

	const session: PlaybackSession = {
		engine,
		kind: 'plex',
		url: streamUrl,
		mode,
		playSessionId: sessionId,
		mediaSourceId: String(media.id ?? part.id ?? item.id),
		audioTracks: filterAudioTracks(streams),
		subtitleTracks: filterTextSubtitles(streams),
		burnableSubtitleTracks: filterImageSubtitles(streams),
		sourceHeight,
		// Plex-specific hls.js tuning, scoped to this session so Jellyfin
		// (and everything else) keeps hls.js's defaults:
		//  - Plex's transcoder lazily 404s segments not yet emitted; crank
		//    fragLoadingMaxRetry so routine "wait a moment" 404s don't
		//    surface to the app as stalls.
		//  - Plex occasionally 400s the first /start.m3u8 while its
		//    metadata probe races with session creation; retries get us
		//    past the cold start.
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

	// Wrap the stream URL through the Rust proxy — strips X-Plex-Token from
	// the client-visible URL and pipes bytes zero-copy. Same treatment we give
	// Jellyfin streams; `kind: 'plex'` tells the proxy to apply Plex-specific
	// quirks (VOD-normalize the live-style manifest, enforce waitForSegments=1
	// on every hop) that Jellyfin sessions don't need.
	const proxySession = await createStreamSession({
		upstreamUrl: session.url,
		authHeaders: plexHeaders(token),
		isHls: engine === 'hls',
		kind: 'plex'
	});
	if (proxySession) {
		session.url = proxySession.streamUrl;
	}

	// Wire up changeQuality to re-negotiate
	session.changeQuality = async (newPlan: PlaybackPlan) => {
		return plexNegotiatePlayback(config, userCred, item, { ...plan, ...newPlan }, caps);
	};

	// Wire up close to tell Plex to tear down the transcode session
	session.close = async () => {
		if (mode !== 'transcode') return;
		try {
			const base = config.url.replace(/\/+$/, '');
			const stopUrl = new URL(`${base}/video/:/transcode/universal/stop`);
			stopUrl.searchParams.set('session', sessionId);
			await fetch(stopUrl.toString(), {
				headers: plexHeaders(token),
				signal: AbortSignal.timeout(5000)
			});
		} catch {
			/* best-effort */
		}
	};

	return session;
}
