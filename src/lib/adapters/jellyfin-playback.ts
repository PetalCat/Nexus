import type { ServiceConfig, UserCredential } from './types';
import type { PlaybackPlan, PlaybackSession, BrowserCaps, PlaybackMode, TrackInfo } from './playback';
import { buildDeviceProfile } from './jellyfin-profile';
import { createStreamSession } from '$lib/server/stream-proxy';

const IMAGE_SUB_CODECS = new Set(['pgssub', 'pgs', 'dvbsub', 'dvdsub', 'vobsub', 'hdmv_pgs_subtitle']);

// ── Exported helpers (tested independently) ────────────────────────────

export function derivePlaybackMode(source: {
	SupportsDirectPlay?: boolean;
	SupportsDirectStream?: boolean;
	TranscodingUrl?: string | null;
}): PlaybackMode {
	if (source.TranscodingUrl) return 'transcode';
	if (source.SupportsDirectPlay) return 'direct-play';
	if (source.SupportsDirectStream) return 'direct-stream';
	return 'transcode';
}

export function filterTextSubtitles(streams: any[]): TrackInfo[] {
	return streams
		.filter((s) => s.Type === 'Subtitle' && !IMAGE_SUB_CODECS.has(String(s.Codec ?? '').toLowerCase()))
		.map((s) => ({
			id: s.Index as number,
			name: (s.DisplayTitle ?? s.DisplayLanguage ?? s.Language ?? `Sub ${s.Index}`) as string,
			lang: (s.Language ?? '') as string,
			codec: s.Codec as string | undefined,
			isExternal: (s.IsExternal ?? false) as boolean,
		}));
}

export function filterImageSubtitles(streams: any[]): TrackInfo[] {
	return streams
		.filter((s) => s.Type === 'Subtitle' && IMAGE_SUB_CODECS.has(String(s.Codec ?? '').toLowerCase()))
		.map((s) => ({
			id: s.Index as number,
			name: (s.DisplayTitle ?? s.DisplayLanguage ?? s.Language ?? `Sub ${s.Index}`) as string,
			lang: (s.Language ?? '') as string,
			codec: s.Codec as string | undefined,
			isExternal: (s.IsExternal ?? false) as boolean,
		}));
}

export function filterAudioTracks(streams: any[]): TrackInfo[] {
	return streams
		.filter((s) => s.Type === 'Audio')
		.map((s) => ({
			id: s.Index as number,
			name: (s.DisplayTitle ?? s.DisplayLanguage ?? s.Language ?? `Audio ${s.Index}`) as string,
			lang: (s.Language ?? '') as string,
			codec: s.Codec as string | undefined,
		}));
}

export function mapPlaybackInfoToSession(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	info: any,
	plan: PlaybackPlan,
	caps: BrowserCaps
): PlaybackSession {
	const source = info.MediaSources?.[0];
	if (!source) throw new Error('No media sources returned from PlaybackInfo');

	const mode = derivePlaybackMode(source);
	const streams: any[] = source.MediaStreams ?? [];
	const playSessionId = info.PlaySessionId as string | undefined;

	// Jellyfin returns TranscodingUrl as a relative path starting with /videos/...
	// For direct-play, we build the direct stream URL ourselves.
	let streamUrl: string;
	if (source.TranscodingUrl) {
		streamUrl = `${config.url}${source.TranscodingUrl}`;
	} else {
		const itemId = source.Id ?? source.ItemId ?? '';
		streamUrl = `${config.url}/Videos/${itemId}/stream?static=true&MediaSourceId=${itemId}`;
		if (userCred?.externalUserId) {
			streamUrl += `&UserId=${userCred.externalUserId}`;
		}
	}

	const session: PlaybackSession = {
		engine: source.TranscodingUrl ? 'hls' : 'progressive',
		url: streamUrl,
		mode,
		playSessionId,
		mediaSourceId: source.Id,
		audioTracks: filterAudioTracks(streams),
		subtitleTracks: filterTextSubtitles(streams),
		burnableSubtitleTracks: filterImageSubtitles(streams),
	};

	return session;
}

// ── Main entry point ───────────────────────────────────────────────────

export async function jellyfinNegotiatePlayback(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	item: { id: string; type: string; title?: string },
	plan: PlaybackPlan,
	caps: BrowserCaps
): Promise<PlaybackSession> {
	const token = userCred?.accessToken ?? config.apiKey ?? '';
	const userId = userCred?.externalUserId ?? '';

	const profile = buildDeviceProfile(caps, plan);

	const body: Record<string, unknown> = {
		UserId: userId,
		DeviceProfile: profile,
		EnableDirectPlay: true,
		EnableDirectStream: true,
		EnableTranscoding: true,
		AllowVideoStreamCopy: true,
		AllowAudioStreamCopy: true,
		AutoOpenLiveStream: true,
	};
	if (plan.maxBitrate) body.MaxStreamingBitrate = plan.maxBitrate;
	if (plan.startPositionSeconds) {
		body.StartTimeTicks = Math.round(plan.startPositionSeconds * 10_000_000);
	}
	if (plan.burnSubIndex !== undefined) {
		body.SubtitleStreamIndex = plan.burnSubIndex;
	}

	const res = await fetch(`${config.url}/Items/${item.id}/PlaybackInfo`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-playback", Version="1.0.0", Token="${token}"`,
			'X-Emby-Token': token,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(10_000),
	});

	if (!res.ok) {
		throw new Error(`Jellyfin PlaybackInfo failed: ${res.status}`);
	}

	const info = await res.json();
	const session = mapPlaybackInfoToSession(config, userCred, info, plan, caps);

	// Wrap the stream URL through the Rust proxy for ApiKey stripping + byte pipe
	const proxySession = await createStreamSession({
		upstreamUrl: session.url,
		authHeaders: {
			Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-playback", Version="1.0.0", Token="${token}"`,
			'X-Emby-Token': token,
		},
		isHls: session.engine === 'hls',
	});
	if (proxySession) {
		session.url = proxySession.streamUrl;
	}

	// Wire up changeQuality to re-negotiate
	session.changeQuality = async (newPlan: PlaybackPlan) => {
		return jellyfinNegotiatePlayback(config, userCred, item, { ...plan, ...newPlan }, caps);
	};

	// Wire up close to report playback stopped
	session.close = async () => {
		if (!session.playSessionId) return;
		try {
			await fetch(`${config.url}/Sessions/Playing/Stopped`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-playback", Version="1.0.0", Token="${token}"`,
					'X-Emby-Token': token,
				},
				body: JSON.stringify({ PlaySessionId: session.playSessionId }),
				signal: AbortSignal.timeout(5000),
			});
		} catch { /* best-effort */ }
	};

	return session;
}
