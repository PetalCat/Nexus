/**
 * Playback speed resolver for `<video>` element playbackRate.
 *
 * Precedence (most → least specific):
 *   1. video rule (exact source ID match)
 *   2. channel rule (for video-type content with a channel ID)
 *   3. type rule (movie | show | episode | video | audio | etc.)
 *   4. default rule
 *   5. hardcoded 1.0 fallback
 *
 * See docs/superpowers/specs/2026-04-17-player-alignment-plan.md §5.
 */

export interface SpeedRule {
	scope: string; // 'default' | 'type' | 'channel' | 'video'
	scopeValue: string | null;
	speed: number;
}

/**
 * Resolve the playback rate for a given media item.
 *
 * @param rules     — the user's full speed-rule list (as served by /api/speed)
 * @param mediaType — the item's unified type (movie, show, episode, video, audio, ...)
 * @param mediaId   — the item's source ID (used for the video-specific rule)
 * @param channelId — optional YouTube channel / artist ID for channel rules
 */
export function resolvePlaybackRate(
	rules: SpeedRule[],
	mediaType: string | undefined,
	mediaId?: string,
	channelId?: string
): number {
	if (!rules || rules.length === 0) return 1;

	// 1. exact video match
	if (mediaId) {
		const hit = rules.find((r) => r.scope === 'video' && r.scopeValue === mediaId);
		if (hit && isValidSpeed(hit.speed)) return hit.speed;
	}

	// 2. channel
	if (channelId) {
		const hit = rules.find((r) => r.scope === 'channel' && r.scopeValue === channelId);
		if (hit && isValidSpeed(hit.speed)) return hit.speed;
	}

	// 3. type
	if (mediaType) {
		const hit = rules.find((r) => r.scope === 'type' && r.scopeValue === mediaType);
		if (hit && isValidSpeed(hit.speed)) return hit.speed;
	}

	// 4. default
	const def = rules.find((r) => r.scope === 'default');
	if (def && isValidSpeed(def.speed)) return def.speed;

	// 5. fallback
	return 1;
}

function isValidSpeed(s: unknown): s is number {
	return typeof s === 'number' && isFinite(s) && s > 0 && s <= 16;
}
