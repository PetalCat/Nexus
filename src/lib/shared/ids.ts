/**
 * Composite identifier helpers for multi-instance service data.
 *
 * Canonical format: `${serviceId}:${sourceId}`. Matches the JSDoc on
 * `UnifiedMedia.id` and the Sonarr/Radarr/NexusRequest convention.
 */

/** Build a composite `${serviceId}:${sourceId}` ID. */
export function buildCompositeId(serviceId: string, sourceId: string | number): string {
	return `${serviceId}:${String(sourceId)}`;
}

/**
 * Split a composite ID. Returns null if the input doesn't contain a colon,
 * meaning it's already a bare `sourceId`.
 *
 * `sourceId` may contain its own colons (e.g. base64 separators) — we split on
 * the FIRST colon only and keep the rest as `sourceId`.
 */
export function parseCompositeId(
	composite: string
): { serviceId: string; sourceId: string } | null {
	const idx = composite.indexOf(':');
	if (idx <= 0 || idx === composite.length - 1) return null;
	return {
		serviceId: composite.slice(0, idx),
		sourceId: composite.slice(idx + 1)
	};
}
