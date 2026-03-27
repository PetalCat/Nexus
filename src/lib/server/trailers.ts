// src/lib/server/trailers.ts
import { withCache } from './cache';
import { getEnabledConfigs } from './services';

/**
 * Resolve a trailer URL for a media item.
 * 1. Check metadata.trailerUrl (from Jellyfin RemoteTrailers — typically YouTube)
 * 2. If YouTube URL + Invidious configured, resolve to proxied stream URL
 * 3. If no trailer from Jellyfin + Invidious configured, search for one
 * 4. Returns a playable stream URL or null
 */
export async function resolveTrailerUrl(
	mediaId: string,
	serviceId: string,
	title: string,
	year?: number,
	metadataTrailerUrl?: string | null,
	userId?: string
): Promise<string | null> {
	const cacheKey = `trailer:${mediaId}:${serviceId}`;

	return withCache(cacheKey, 24 * 60 * 60 * 1000, async () => {
		// Step 1: Try Jellyfin's RemoteTrailers URL
		const youtubeId = extractYouTubeId(metadataTrailerUrl);

		// Step 2: If we have a YouTube ID, resolve via Invidious
		if (youtubeId) {
			const streamUrl = await resolveViaInvidious(youtubeId);
			if (streamUrl) return streamUrl;
		}

		// Step 3: No Jellyfin trailer — search Invidious
		if (!youtubeId) {
			const searchUrl = await searchInvidiousTrailer(title, year);
			if (searchUrl) return searchUrl;
		}

		return null;
	});
}

function extractYouTubeId(url?: string | null): string | null {
	if (!url) return null;
	const match = url.match(
		/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
	);
	return match?.[1] ?? null;
}

function getInvidiousConfig(): { url: string } | null {
	const configs = getEnabledConfigs();
	const invConfig = configs.find((c) => c.type === 'invidious');
	if (!invConfig) return null;
	return { url: invConfig.url };
}

async function resolveViaInvidious(youtubeId: string): Promise<string | null> {
	const inv = getInvidiousConfig();
	if (!inv) return null;

	try {
		const baseUrl = inv.url.replace(/\/$/, '');
		const res = await fetch(`${baseUrl}/api/v1/videos/${youtubeId}`, {
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) return null;
		const data = await res.json();

		// Prefer adaptive format (720p or lower for trailers)
		const stream = data.adaptiveFormats
			?.filter((f: any) => f.type?.startsWith('video/mp4') && f.qualityLabel)
			?.sort((a: any, b: any) => {
				const aH = parseInt(a.qualityLabel) || 0;
				const bH = parseInt(b.qualityLabel) || 0;
				if (aH <= 720 && bH <= 720) return bH - aH;
				if (aH <= 720) return -1;
				if (bH <= 720) return 1;
				return aH - bH;
			})?.[0];

		if (stream?.url) return stream.url;

		// Fallback to format streams
		const fallback = data.formatStreams?.find(
			(f: any) => f.type?.startsWith('video/mp4')
		);
		return fallback?.url ?? null;
	} catch {
		return null;
	}
}

async function searchInvidiousTrailer(
	title: string,
	year?: number
): Promise<string | null> {
	const inv = getInvidiousConfig();
	if (!inv) return null;

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

		return resolveViaInvidious(firstVideo.videoId);
	} catch {
		return null;
	}
}
