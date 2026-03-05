import { getActiveUserIds, rebuildStatsForUser, buildAndCacheStats } from './stats-engine';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;

function runScheduledRebuilds() {
	tickCount++;
	const userIds = getActiveUserIds();

	for (const userId of userIds) {
		try {
			// Always rebuild current day (5 min cycle)
			buildAndCacheStats(userId, 'day', 'all');

			// Every 6th tick (30 min) — rebuild week
			if (tickCount % 6 === 0) {
				buildAndCacheStats(userId, 'week', 'all');
			}

			// Every 24th tick (2 hours) — rebuild month
			if (tickCount % 24 === 0) {
				buildAndCacheStats(userId, 'month', 'all');
			}

			// Every 72nd tick (6 hours) — rebuild year
			if (tickCount % 72 === 0) {
				buildAndCacheStats(userId, 'year', 'all');
			}

			// Every 144th tick (12 hours) — full rebuild all periods + media types
			if (tickCount % 144 === 0) {
				rebuildStatsForUser(userId);
			}
		} catch (e) {
			console.error(`[stats-scheduler] Error for user ${userId}:`, e);
		}
	}
}

export function startStatsScheduler() {
	if (schedulerInterval) return;
	console.log('[stats-scheduler] Starting stats rebuild scheduler (5min interval)');
	schedulerInterval = setInterval(runScheduledRebuilds, 5 * 60 * 1000);
	// Run first rebuild after 30 seconds (let the app finish booting)
	setTimeout(runScheduledRebuilds, 30_000);
}

export function stopStatsScheduler() {
	if (schedulerInterval) {
		clearInterval(schedulerInterval);
		schedulerInterval = null;
	}
}
