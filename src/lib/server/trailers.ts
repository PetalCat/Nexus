// src/lib/server/trailers.ts
import { withCache, invalidate } from './cache';
import { getConfigsForMediaType } from './services';

export interface TrailerInfo {
	/** High-quality adaptive video stream (may be video-only) */
	video: string;
	/** Separate audio stream for synced playback (null if video is muxed) */
	audio: string | null;
}

/**
 * Resolve trailer streams for a media item.
 * 1. Check metadata.trailerUrl (from Jellyfin RemoteTrailers — typically YouTube)
 * 2. If YouTube URL found + Invidious configured, resolve video + audio streams
 * 3. If no Jellyfin trailer + Invidious configured, search for one
 * 4. Returns video + audio URLs or null
 */
export async function resolveTrailerUrl(
	mediaId: string,
	serviceId: string,
	title: string,
	year?: number,
	metadataTrailerUrl?: string | null,
	userId?: string
): Promise<TrailerInfo | null> {
	const cacheKey = `trailer:${mediaId}:${serviceId}`;

	const result = await withCache(cacheKey, 24 * 60 * 60 * 1000, async () => {
		const inv = getInvidiousConfig();
		if (!inv) return null;

		// Step 1: Try Jellyfin's RemoteTrailers URL (YouTube)
		const youtubeId = extractYouTubeId(metadataTrailerUrl);
		const videoId = youtubeId ?? await searchInvidiousTrailer(inv, title, year);

		if (!videoId) return null;

		// Resolve best audio itag for synced playback
		const audioItag = await resolveBestAudioItag(inv, videoId);

		return {
			video: `/api/video/stream/${videoId}`,
			audio: audioItag ? `/api/video/stream/${videoId}?itag=${audioItag}` : null
		};
	});

	// Don't let a negative result poison the cache for 24h — if the user
	// didn't have Invidious configured yet or a lookup transiently failed,
	// we want the next call to retry. Drop null results immediately.
	if (result === null) invalidate(cacheKey);
	return result;
}

function extractYouTubeId(url?: string | null): string | null {
	if (!url) return null;
	const match = url.match(
		/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
	);
	return match?.[1] ?? null;
}

function getInvidiousConfig(): { serviceId: string; url: string } | null {
	const videoConfigs = getConfigsForMediaType('video');
	const config = videoConfigs[0];
	if (!config) return null;
	return { serviceId: config.id, url: config.url };
}

/** Preferred audio itags: opus > aac, higher bitrate first */
const PREFERRED_AUDIO_ITAGS = [
	'251',  // opus 160kbps
	'250',  // opus 70kbps
	'249',  // opus 50kbps
	'140',  // aac 128kbps
	'139',  // aac 48kbps
];

async function resolveBestAudioItag(
	inv: { url: string },
	videoId: string
): Promise<string | null> {
	try {
		const baseUrl = inv.url.replace(/\/$/, '');
		const res = await fetch(
			`${baseUrl}/api/v1/videos/${encodeURIComponent(videoId)}?fields=adaptiveFormats`,
			{ signal: AbortSignal.timeout(8000) }
		);
		if (!res.ok) return null;
		const meta = await res.json();

		const available = new Set<string>();
		for (const f of (meta.adaptiveFormats ?? [])) {
			if ((f.type ?? '').startsWith('audio/')) {
				available.add(String(f.itag));
			}
		}

		for (const itag of PREFERRED_AUDIO_ITAGS) {
			if (available.has(itag)) return itag;
		}
	} catch { /* silent */ }
	return null;
}

async function searchInvidiousTrailer(
	inv: { url: string },
	title: string,
	year?: number
): Promise<string | null> {
	try {
		const query = `${title} ${year ?? ''} official trailer`.trim();
		const baseUrl = inv.url.replace(/\/$/, '');
		const res = await fetch(
			`${baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`,
			{ signal: AbortSignal.timeout(8000) }
		);
		if (!res.ok) return null;
		const results = await res.json();

		const firstVideo = results?.[0];
		if (!firstVideo?.videoId) return null;

		return firstVideo.videoId;
	} catch {
		return null;
	}
}
