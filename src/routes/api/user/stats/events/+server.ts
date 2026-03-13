import { json } from '@sveltejs/kit';
import { queryMediaEvents, countMediaEvents } from '$lib/server/analytics';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats/events?type=movie&event=play_stop&from=...&to=...&limit=50&offset=0
 * Returns raw media events for the user.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const mediaType = url.searchParams.get('type') ?? undefined;
	const eventType = url.searchParams.get('event') ?? undefined;
	const from = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!) : undefined;
	const to = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!) : undefined;
	const serviceId = url.searchParams.get('serviceId') ?? undefined;
	const titleSearch = url.searchParams.get('titleSearch') ?? undefined;
	const limit = Math.min(500, parseInt(url.searchParams.get('limit') ?? '50'));
	const offset = parseInt(url.searchParams.get('offset') ?? '0');

	const opts = { userId: locals.user.id, mediaType, eventType, from, to, serviceId, titleSearch, limit, offset };
	const events = queryMediaEvents(opts);
	const total = countMediaEvents({ userId: locals.user.id, mediaType, eventType, from, to, serviceId, titleSearch });

	return json({ events, total, limit, offset });
};
