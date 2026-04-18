/**
 * Per-service history thumbnail resolver.
 *
 * The history feed stores raw `(service_id, service_type, media_id, media_type)`
 * tuples — not resolved image URLs — so each row needs to be rendered against
 * the adapter that produced it. Previously every row was rendered with the
 * Jellyfin `/Items/{id}/Images/Primary` shape, which broke thumbnails for
 * every non-Jellyfin service (Invidious, Calibre, RomM, Plex …).
 *
 * This helper returns a best-effort poster URL string per row, or `null` if
 * the service type cannot produce one from `(mediaId, mediaType)` alone. The
 * component falls back to a colored placeholder block when null.
 */

interface ResolveInput {
	serviceId: string;
	serviceType: string | null | undefined;
	mediaId: string;
	mediaType: string;
	/** Base URL of the originating service, if known (needed for Jellyfin/Plex). */
	serviceUrl: string | undefined;
}

export function resolveHistoryPoster(input: ResolveInput): string | null {
	const { serviceId, serviceType, mediaId, mediaType, serviceUrl } = input;
	if (!serviceType || !mediaId) return null;

	switch (serviceType) {
		case 'jellyfin':
		case 'streamystats':
		case 'plex': {
			// Jellyfin/Plex images are served directly by the origin server.
			// If the server URL isn't known we can't build a URL.
			if (!serviceUrl) return null;
			return `${serviceUrl}/Items/${mediaId}/Images/Primary?maxHeight=88&quality=80`;
		}
		case 'invidious': {
			// YouTube/Invidious video thumbnails are on the ytimg CDN and
			// keyed by the YouTube video ID, which is the `mediaId` we store.
			if (mediaType !== 'video') return null;
			return `https://i.ytimg.com/vi/${mediaId}/mqdefault.jpg`;
		}
		case 'calibre': {
			// Calibre-Web covers require auth — proxy through Nexus.
			return `/api/media/image?service=${encodeURIComponent(serviceId)}&path=${encodeURIComponent(`/cover/${mediaId}`)}`;
		}
		case 'romm': {
			// RomM covers require auth. We don't have the exact cover path in
			// play_sessions, but the RomM API exposes covers keyed by rom id,
			// so proxy a canonical path and let the adapter layer handle it.
			return `/api/media/image?service=${encodeURIComponent(serviceId)}&path=${encodeURIComponent(`/api/roms/${mediaId}/cover`)}`;
		}
		default:
			return null;
	}
}
