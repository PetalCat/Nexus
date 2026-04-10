import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { bazarrAdapter } from '$lib/adapters/bazarr';

/**
 * POST /api/subtitles/download
 *
 * Trigger a subtitle download via Bazarr.
 * Body: { serviceId?, itemId, language, hi?, forced?, provider?, mediaType }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const { itemId, language, hi, forced, provider, mediaType } = body;

	if (!itemId || !language || !mediaType) {
		throw error(400, 'Missing required fields: itemId, language, mediaType');
	}

	const bazarrConfigs = getEnabledConfigs().filter((c) => c.type === 'bazarr');
	if (bazarrConfigs.length === 0) {
		throw error(404, 'No Bazarr service configured');
	}

	const config = bazarrConfigs[0];

	try {
		await bazarrAdapter.setItemStatus!(config, itemId, {
			action: 'download-subtitle',
			language,
			hi: hi ?? false,
			forced: forced ?? false,
			provider,
			mediaType
		});
		return json({ success: true });
	} catch (e) {
		console.error('[subtitles/download] error:', e);
		throw error(502, e instanceof Error ? e.message : 'Download failed');
	}
};
