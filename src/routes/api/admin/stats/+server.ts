import { json } from '@sveltejs/kit';
import { getActiveUserIds, getOrComputeStats } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/admin/stats?period=month:2026-03
 * Server-wide aggregate stats (admin only).
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const period = url.searchParams.get('period') ?? 'alltime';
	const userIds = getActiveUserIds();

	let totalPlayTimeMs = 0;
	let totalSessions = 0;
	let totalItems = 0;
	let totalPageViews = 0;
	const genreAgg = new Map<string, number>();
	const deviceAgg = new Map<string, number>();

	for (const uid of userIds) {
		const stats = getOrComputeStats(uid, period, 'all', 600_000);
		totalPlayTimeMs += stats.totalPlayTimeMs;
		totalSessions += stats.totalSessions;
		totalItems += stats.totalItems;
		totalPageViews += stats.totalPageViews;

		for (const g of stats.topGenres) {
			genreAgg.set(g.genre, (genreAgg.get(g.genre) ?? 0) + g.playTimeMs);
		}
		for (const d of stats.topDevices) {
			deviceAgg.set(d.name, (deviceAgg.get(d.name) ?? 0) + d.playTimeMs);
		}
	}

	const topGenres = [...genreAgg.entries()]
		.map(([genre, playTimeMs]) => ({ genre, playTimeMs }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs)
		.slice(0, 20);

	const topDevices = [...deviceAgg.entries()]
		.map(([name, playTimeMs]) => ({ name, playTimeMs }))
		.sort((a, b) => b.playTimeMs - a.playTimeMs)
		.slice(0, 10);

	return json({
		period,
		activeUsers: userIds.length,
		totalPlayTimeMs,
		totalSessions,
		totalItems,
		totalPageViews,
		topGenres,
		topDevices
	});
};
