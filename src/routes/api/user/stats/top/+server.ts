import { json } from '@sveltejs/kit';
import { getOrComputeStats } from '$lib/server/stats-engine';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats/top?category=genres|items|devices|clients&period=year:2025&limit=20
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const category = url.searchParams.get('category') ?? 'items';
	const period = url.searchParams.get('period') ?? 'alltime';
	const mediaType = url.searchParams.get('type') ?? 'all';
	const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '20'));

	const stats = getOrComputeStats(locals.user.id, period, mediaType);

	let data: unknown[];
	switch (category) {
		case 'genres': data = stats.topGenres.slice(0, limit); break;
		case 'items': data = stats.topItems.slice(0, limit); break;
		case 'devices': data = stats.topDevices.slice(0, limit); break;
		case 'clients': data = stats.topClients.slice(0, limit); break;
		default: data = stats.topItems.slice(0, limit);
	}

	return json({ category, period, mediaType, data });
};
