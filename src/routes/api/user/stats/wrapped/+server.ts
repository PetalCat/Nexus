import { json } from '@sveltejs/kit';
import { computeWrapped } from '$lib/server/wrapped';
import type { RequestHandler } from './$types';

/**
 * GET /api/user/stats/wrapped?year=2025
 * Thin wrapper around the one canonical `computeWrapped()` helper so the
 * page-SSR route and this HTTP surface can never disagree on the shape or
 * the underlying query. (Formerly this delegated to `getOrComputeStats()`
 * with a different shape — see data-model unification spec.)
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const yearParam = url.searchParams.get('year');
	const now = new Date();
	const year = yearParam ? parseInt(yearParam, 10) : now.getFullYear();
	if (!Number.isInteger(year) || year < 1900 || year > 9999) {
		return json({ error: 'Invalid year' }, { status: 400 });
	}

	return json(computeWrapped(locals.user.id, year));
};
