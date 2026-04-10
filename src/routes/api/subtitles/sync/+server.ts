import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { bazarrAdapter } from '$lib/adapters/bazarr';

/**
 * POST /api/subtitles/sync
 *
 * Sync subtitle timing via Bazarr (Golden-Section Search algorithm).
 * Body: { itemId, language, path, mediaType }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const { itemId, language, path, mediaType } = body;

	if (!itemId || !language || !path) {
		throw error(400, 'Missing required fields: itemId, language, path');
	}

	const bazarrConfigs = getEnabledConfigs().filter((c) => c.type === 'bazarr');
	if (bazarrConfigs.length === 0) {
		throw error(404, 'No Bazarr service configured');
	}

	const config = bazarrConfigs[0];

	try {
		await bazarrAdapter.setItemStatus!(config, itemId, {
			action: 'sync-subtitle',
			language,
			path,
			mediaType: mediaType ?? 'movie'
		});
		return json({ success: true });
	} catch (e) {
		console.error('[subtitles/sync] error:', e);
		throw error(502, e instanceof Error ? e.message : 'Sync failed');
	}
};
