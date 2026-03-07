import { json } from '@sveltejs/kit';
import { getActiveUserIds, rebuildStatsForUser } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * POST /api/admin/system/stats/rebuild
 * Trigger full stats rebuild for all active users.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const userIds = getActiveUserIds();
	let rebuilt = 0;

	for (const uid of userIds) {
		try {
			rebuildStatsForUser(uid);
			rebuilt++;
		} catch (e) {
			console.error(`[admin] Failed to rebuild stats for ${uid}:`, e);
		}
	}

	return json({ rebuilt, total: userIds.length });
};
