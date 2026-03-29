import { getRawDb } from '$lib/db';
import { getEnabledConfigs, resolveUserCred } from './services';
import { registry } from '$lib/adapters/registry';
import { withCache } from './cache';
import type { UnifiedMedia } from '$lib/adapters/types';

export interface Suggestion {
	item: UnifiedMedia;
	reason: string;
	confidence: number;
}

/**
 * Generate suggestions based on a user's recent viewing activity.
 * Finds recently watched items, fetches TMDB recommendations via Seerr/Overseerr,
 * and filters to content not already in the library.
 */
export async function getSuggestions(userId: string, limit = 10): Promise<Suggestion[]> {
	return withCache(`suggestions:${userId}`, 600_000, async () => {
		const raw = getRawDb();
		const suggestions: Suggestion[] = [];

		// Get recently watched items with TMDB IDs
		const recentActivity = raw.prepare(`
			SELECT DISTINCT media_title, media_type,
			       json_extract(metadata, '$.tmdbId') as tmdb_id
			FROM play_sessions
			WHERE user_id = ? AND duration_ms > 300000
			ORDER BY started_at DESC
			LIMIT 20
		`).all(userId) as Array<{
			media_title: string;
			media_type: string;
			tmdb_id: string | null;
		}>;

		if (recentActivity.length === 0) return [];

		// Find adapters with getSimilar (Overseerr/Seerr)
		const configs = getEnabledConfigs().filter(c => {
			const adapter = registry.get(c.type);
			return !!adapter?.getSimilar;
		});

		if (configs.length === 0) return [];

		const seen = new Set<string>();

		// For each recent item with a TMDB ID, get recommendations
		for (const activity of recentActivity.slice(0, 5)) {
			if (!activity.tmdb_id) continue;

			for (const config of configs) {
				const adapter = registry.get(config.type);
				if (!adapter?.getSimilar) continue;
				const cred = resolveUserCred(config, userId);

				try {
					const mediaType = activity.media_type === 'movie' ? 'movie' : 'tv';
					const similar = await adapter.getSimilar(config, `${mediaType}:${activity.tmdb_id}`, cred);

					for (const item of similar.slice(0, 3)) {
						const key = `${item.sourceId}:${item.serviceId}`;
						if (seen.has(key)) continue;
						seen.add(key);

						// Only suggest items NOT already available
						if (item.status === 'available') continue;

						suggestions.push({
							item,
							reason: `Because you watched ${activity.media_title}`,
							confidence: 0.7
						});
					}
				} catch { continue; }
			}
		}

		suggestions.sort((a, b) => b.confidence - a.confidence);
		return suggestions.slice(0, limit);
	});
}
