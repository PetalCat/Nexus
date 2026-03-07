import { json } from '@sveltejs/kit';
import { invalidateAll, invalidatePrefix } from '$lib/server/cache';
import type { RequestHandler } from './$types';

/**
 * POST /api/admin/system/cache/clear
 * Clear all cache or a prefix. Body: { prefix?: string }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const body = await request.json().catch(() => ({}));
	const prefix = body.prefix as string | undefined;

	if (prefix) {
		invalidatePrefix(prefix);
		return json({ cleared: prefix });
	}

	invalidateAll();
	return json({ cleared: 'all' });
};
