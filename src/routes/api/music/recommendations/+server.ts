import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { getStreamyStatsRecommendations } from '$lib/adapters/streamystats';
import { withCache } from '$lib/server/cache';
import { getRecentlyPlayed } from '$lib/server/music';

// GET /api/music/recommendations?limit=20
// Returns music recommendations from StreamyStats if available,
// otherwise falls back to recently played music from Jellyfin
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const limit = parseInt(url.searchParams.get('limit') ?? '20');
	const userId = locals.user.id;

	// Try StreamyStats first
	const ssConfigs = getEnabledConfigs().filter((c) => c.type === 'streamystats');
	if (ssConfigs.length > 0) {
		// StreamyStats authenticates via Jellyfin token
		const jellyfinConfig = getEnabledConfigs().find((c) => c.type === 'jellyfin');
		if (jellyfinConfig) {
			const userCred = getUserCredentialForService(userId, jellyfinConfig.id) ?? undefined;
			if (userCred?.accessToken) {
				try {
					const items = await withCache(
						`music-recs:${userId}:${ssConfigs[0].id}`,
						300_000,
						() => getStreamyStatsRecommendations(ssConfigs[0], 'all', userCred, limit)
					);
					// Filter to music-type items if possible
					const musicItems = items.filter(
						(i) => i.type === 'music' || i.type === 'album'
					);
					if (musicItems.length > 0) {
						return json({ items: musicItems.slice(0, limit) });
					}
					// If StreamyStats returned items but none are music, fall through
				} catch (e) {
					console.error('[Music Recommendations] StreamyStats error:', e instanceof Error ? e.message : e);
				}
			}
		}
	}

	// Fallback: recently played music tracks
	const recentTracks = getRecentlyPlayed(userId, limit);
	return json({ items: recentTracks });
};
