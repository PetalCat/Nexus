import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { bazarrAdapter } from '$lib/adapters/bazarr';

/**
 * POST /api/subtitles/translate
 *
 * Translate a subtitle via Bazarr.
 * Body: { itemId, language, path, mediaType }
 *
 * Note: Bazarr's Whisper-based translation currently only supports
 * translation to English. The `language` field specifies the source
 * subtitle language to translate from.
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
			action: 'translate-subtitle',
			language,
			path,
			mediaType: mediaType ?? 'movie'
		});
		return json({ success: true });
	} catch (e) {
		console.error('[subtitles/translate] error:', e);
		throw error(502, e instanceof Error ? e.message : 'Translation failed');
	}
};
