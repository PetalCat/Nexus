import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { bazarrAdapter } from '$lib/adapters/bazarr';

/**
 * DELETE /api/subtitles
 *
 * Delete a subtitle file via Bazarr.
 * Body: { itemId, language, path, mediaType }
 */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const { itemId, language, path, mediaType } = body;

	if (!itemId || !language || !path || !mediaType) {
		throw error(400, 'Missing required fields: itemId, language, path, mediaType');
	}

	const bazarrConfigs = getEnabledConfigs().filter((c) => c.type === 'bazarr');
	if (bazarrConfigs.length === 0) {
		throw error(404, 'No Bazarr service configured');
	}

	const config = bazarrConfigs[0];

	try {
		await bazarrAdapter.setItemStatus!(config, itemId, {
			action: 'delete-subtitle',
			language,
			path,
			mediaType
		});
		return json({ success: true });
	} catch (e) {
		console.error('[subtitles/delete] error:', e);
		throw error(502, e instanceof Error ? e.message : 'Delete failed');
	}
};
