import { getRawDb } from '$lib/db';
import { computeGenreAffinity, persistGenreAffinity } from './recommendations/providers/content-based';
import { recRegistry } from './recommendations/registry';
import { contentBasedProvider } from './recommendations/providers/content-based';
import { streamyStatsProvider } from './recommendations/providers/streamystats';
import { collaborativeProvider } from './recommendations/providers/collaborative';
import { socialProvider } from './recommendations/providers/social';
import { trendingProvider } from './recommendations/providers/trending';
import { timeAwareProvider } from './recommendations/providers/time-aware';
import { getRecommendations } from './recommendations/aggregator';
import { invalidatePrefix, withCache } from './cache';
import { buildHomepageCache, invalidateHomepageCache } from './homepage-cache';
import { syncMediaItems, hasMediaItems } from './media-sync';

// ---------------------------------------------------------------------------
// Recommendation Scheduler
//
// Background job that periodically rebuilds genre affinity vectors and
// pre-computes recommendations for all active users.
// ---------------------------------------------------------------------------

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;
let initialized = false;

/** Get user IDs with recent media events (active in last 30 days) */
function getActiveUserIds(): string[] {
	const raw = getRawDb();
	const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
	const rows = raw.prepare(
		`SELECT DISTINCT user_id FROM media_events WHERE timestamp > ? LIMIT 100`
	).all(cutoff) as Array<{ user_id: string }>;
	return rows.map((r) => r.user_id);
}

const MEDIA_TYPES = ['movie', 'show', 'episode', 'music', 'book', 'game'];

/** Rebuild genre affinity vectors for a user */
function rebuildAffinities(userId: string) {
	for (const mediaType of MEDIA_TYPES) {
		try {
			const affinities = computeGenreAffinity(userId, mediaType);
			persistGenreAffinity(userId, mediaType, affinities);
		} catch (e) {
			console.error(`[rec-scheduler] Affinity rebuild failed for ${userId}/${mediaType}:`, e);
		}
	}

	// Also compute an "all" affinity across all types
	try {
		const affinities = computeGenreAffinity(userId);
		persistGenreAffinity(userId, 'all', affinities);
	} catch (e) {
		console.error(`[rec-scheduler] Affinity rebuild (all) failed for ${userId}:`, e);
	}
}

/** Pre-compute recommendations for a user across all browsable types */
async function precomputeRecs(userId: string) {
	for (const mediaType of ['movie', 'show', 'book', 'game']) {
		try {
			await getRecommendations(userId, mediaType, 30);
		} catch (e) {
			console.error(`[rec-scheduler] Precompute failed for ${userId}/${mediaType}:`, e);
		}
	}
}

function runScheduledRebuilds() {
	tickCount++;
	const userIds = getActiveUserIds();

	// Every 24th tick (2 hours) — re-sync media items from Jellyfin
	if (tickCount % 24 === 0) {
		syncMediaItems().catch((e) =>
			console.error('[rec-scheduler] Periodic media sync error:', e)
		);
	}

	for (const userId of userIds) {
		try {
			// Every 6th tick (30 min) — rebuild genre affinity vectors
			if (tickCount % 6 === 0) {
				rebuildAffinities(userId);
			}

			// Every 12th tick (60 min) — pre-compute recommendations, then build homepage cache
			if (tickCount % 12 === 0) {
				invalidatePrefix(`rec-rows:${userId}`);
				invalidateHomepageCache(userId);
				precomputeRecs(userId).then(() => {
					const cache = buildHomepageCache(userId);
					if (cache) {
						withCache(`homepage:${userId}`, 60 * 60 * 1000, async () => cache);
					}
					console.log(`[rec-scheduler] Homepage cache built for ${userId}`);
				}).catch((e) =>
					console.error(`[rec-scheduler] Precompute error for ${userId}:`, e)
				);
			}
		} catch (e) {
			console.error(`[rec-scheduler] Error for user ${userId}:`, e);
		}
	}
}

/** Initialize provider registry and start the scheduler */
export function startRecScheduler() {
	if (schedulerInterval) return;

	// Register built-in providers (only once)
	if (!initialized) {
		recRegistry.register(contentBasedProvider);
		recRegistry.register(streamyStatsProvider);
		recRegistry.register(collaborativeProvider);
		recRegistry.register(socialProvider);
		recRegistry.register(trendingProvider);
		recRegistry.register(timeAwareProvider);
		initialized = true;
	}

	console.log('[rec-scheduler] Starting recommendation scheduler (5min interval)');
	schedulerInterval = setInterval(runScheduledRebuilds, 5 * 60 * 1000);

	// On startup: sync media items → build affinities → precompute recs
	// Runs after a short delay to let the app finish booting
	setTimeout(async () => {
		console.log('[rec-scheduler] Starting initial data pipeline...');
		try {
			// Step 1: Populate media_items from Jellyfin if empty
			if (!hasMediaItems()) {
				console.log('[rec-scheduler] media_items empty — running initial sync');
				await syncMediaItems();
			} else {
				console.log('[rec-scheduler] media_items already populated');
			}

			// Step 2: Build genre affinities for all active users
			const userIds = getActiveUserIds();
			console.log(`[rec-scheduler] Building affinities for ${userIds.length} users`);
			for (const userId of userIds) {
				rebuildAffinities(userId);
			}
			console.log('[rec-scheduler] Affinities built');

			// Step 3: Precompute recommendations and build homepage cache
			for (const userId of userIds) {
				try {
					invalidatePrefix(`rec-rows:${userId}`);
					invalidateHomepageCache(userId);
					await precomputeRecs(userId);
					const cache = buildHomepageCache(userId);
					if (cache) {
						withCache(`homepage:${userId}`, 60 * 60 * 1000, async () => cache);
					}
					console.log(`[rec-scheduler] Initial homepage cache built for ${userId}`);
				} catch (e) {
					console.error(`[rec-scheduler] Initial precompute error for ${userId}:`, e);
				}
			}
		} catch (e) {
			console.error('[rec-scheduler] Startup sync error:', e);
		}
	}, 10_000);
}

export function stopRecScheduler() {
	if (schedulerInterval) {
		clearInterval(schedulerInterval);
		schedulerInterval = null;
	}
}
