import { json } from '@sveltejs/kit';
import { getOrComputeStats } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats/timeline?from=2026-01&to=2026-03&granularity=day&type=all
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const granularity = url.searchParams.get('granularity') ?? 'day';
	const mediaType = url.searchParams.get('type') ?? 'all';
	const fromStr = url.searchParams.get('from');
	const toStr = url.searchParams.get('to');

	if (!fromStr || !toStr) {
		return json({ error: 'from and to params required (YYYY-MM-DD or YYYY-MM)' }, { status: 400 });
	}

	const points: { period: string; totalPlayTimeMs: number; totalSessions: number; totalItems: number }[] = [];

	if (granularity === 'day') {
		const start = new Date(fromStr);
		const end = new Date(toStr);
		const cursor = new Date(start);
		while (cursor <= end) {
			const pad = (n: number) => String(n).padStart(2, '0');
			const period = `day:${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
			const stats = getOrComputeStats(locals.user.id, period, mediaType, 600_000);
			points.push({
				period,
				totalPlayTimeMs: stats.totalPlayTimeMs,
				totalSessions: stats.totalSessions,
				totalItems: stats.totalItems
			});
			cursor.setDate(cursor.getDate() + 1);
			if (points.length > 366) break;
		}
	} else if (granularity === 'month') {
		const [fy, fm] = fromStr.split('-').map(Number);
		const [ty, tm] = toStr.split('-').map(Number);
		let y = fy, m = fm;
		while (y < ty || (y === ty && m <= tm)) {
			const period = `month:${y}-${String(m).padStart(2, '0')}`;
			const stats = getOrComputeStats(locals.user.id, period, mediaType, 3600_000);
			points.push({
				period,
				totalPlayTimeMs: stats.totalPlayTimeMs,
				totalSessions: stats.totalSessions,
				totalItems: stats.totalItems
			});
			m++;
			if (m > 12) { m = 1; y++; }
			if (points.length > 120) break;
		}
	}

	return json({ granularity, mediaType, points });
};
