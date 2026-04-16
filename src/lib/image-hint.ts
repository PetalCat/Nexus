/**
 * Derive a tiny low-quality placeholder URL from a full-res image URL.
 *
 * Only works for URLs that route through `/api/media/image` (the Nexus
 * image proxy) and whose encoded `path` contains a `maxWidth=` or
 * `maxHeight=` sizing hint we can rewrite. Falls back to the original URL
 * when the transformation isn't safe — so fast-LAN setups that don't need
 * LQIPs silently keep using the full-res URL.
 *
 * The cost is roughly one extra 2–5 KB fetch per card. On a fast LAN the
 * full-res arrives before the LQIP paints, so the LQIP is never visible.
 * On a slow link the LQIP paints in ~100 ms and gets cross-faded out when
 * the full-res catches up.
 */
export function lowResImageUrl(src: string | undefined | null): string | undefined {
	if (!src) return undefined;

	// Only rewrite our own proxy URLs. Third-party and absolute upstream URLs
	// get left alone — we don't know what sizing knobs they accept.
	const marker = '/api/media/image?';
	const idx = src.indexOf(marker);
	if (idx < 0) return undefined;

	const prefix = src.slice(0, idx + marker.length);
	const rest = src.slice(idx + marker.length);

	// Parse the outer query (service + path) to find the inner `path` param.
	const params = new URLSearchParams(rest);
	const pathParam = params.get('path');
	if (!pathParam) return undefined;

	// Only shrink Jellyfin-style /Items/.../Images/... paths — those accept
	// `maxWidth`/`maxHeight`/`quality`. Invidious `/vi/{id}/maxres.jpg` paths
	// aren't parameterized, so skip them.
	if (!pathParam.includes('Images/')) return undefined;

	const rewritten = pathParam
		.replace(/\bmaxWidth=\d+/g, 'maxWidth=80')
		.replace(/\bmaxHeight=\d+/g, 'maxHeight=80')
		.replace(/\bquality=\d+/g, 'quality=35');

	// If the path didn't have any sizing knobs, append our own.
	const hasSizing = rewritten !== pathParam;
	const finalPath = hasSizing
		? rewritten
		: rewritten + (rewritten.includes('?') ? '&' : '?') + 'maxWidth=80&quality=35';

	params.set('path', finalPath);
	return prefix + params.toString();
}
