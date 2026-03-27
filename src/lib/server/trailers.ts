// src/lib/server/trailers.ts
import { withCache } from './cache';
import { getEnabledConfigs } from './services';

/**
 * Resolve a trailer URL for a media item.
 * 1. Check metadata.trailerUrl (from Jellyfin RemoteTrailers — typically YouTube)
 * 2. If YouTube URL found + Invidious configured, return stream proxy URL
 * 3. If no Jellyfin trailer + Invidious configured, search for one
 * 4. Returns a playable stream proxy URL or null
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
		const inv = getInvidiousConfig();
		if (!inv) return null;

		// Step 1: Try Jellyfin's RemoteTrailers URL (YouTube)
		const youtubeId = extractYouTubeId(metadataTrailerUrl);

		if (youtubeId) {
			// Use the existing Invidious video stream proxy
			return `/api/video/stream/${youtubeId}`;
		}

		// Step 2: No Jellyfin trailer — search Invidious for one
		const searchedId = await searchInvidiousTrailer(inv, title, year);
		if (searchedId) {
			return `/api/video/stream/${searchedId}`;
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

function getInvidiousConfig(): { serviceId: string; url: string } | null {
	const configs = getEnabledConfigs();
	const invConfig = configs.find((c) => c.type === 'invidious');
	if (!invConfig) return null;
	return { serviceId: invConfig.id, url: invConfig.url };
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
