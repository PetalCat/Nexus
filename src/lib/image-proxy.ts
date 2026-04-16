/**
 * Rewrite an absolute upstream image URL (Jellyfin, Streamystats, etc.) to
 * route through `/api/media/image?service=...&path=...` so the browser only
 * talks to the Nexus origin.
 *
 * Works in both server and client code — it's pure URL manipulation.
 * Returns the input unchanged if the URL is relative, already proxied, or
 * unparseable.
 */
/** Hosts where the /api/media/image proxy will fetch absolute URLs directly
 *  (without needing a service config). Must match THIRD_PARTY_IMAGE_HOSTS
 *  in src/routes/api/media/image/+server.ts. */
const THIRD_PARTY_HOSTS = new Set([
	'yt3.ggpht.com',
	'i.ytimg.com',
	'lh3.googleusercontent.com',
	'image.tmdb.org',
]);

export function proxyImageUrl(url: string | undefined | null, serviceId: string): string | undefined {
	if (!url) return undefined;
	if (url.startsWith('/api/media/image')) return url;
	if (url.startsWith('/')) return url; // already relative to Nexus origin
	try {
		const parsed = new URL(url);
		if (THIRD_PARTY_HOSTS.has(parsed.hostname)) {
			// Absolute third-party URL — proxy the whole thing verbatim
			return `/api/media/image?service=${encodeURIComponent(serviceId)}&path=${encodeURIComponent(url)}`;
		}
		const path = `${parsed.pathname}${parsed.search}`;
		return `/api/media/image?service=${encodeURIComponent(serviceId)}&path=${encodeURIComponent(path)}`;
	} catch {
		return url;
	}
}
