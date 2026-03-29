import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';

/**
 * POST /api/subtitles/upload
 *
 * Upload a custom subtitle file via Bazarr.
 * Expects multipart form data with: serviceId, itemId, language, mediaType, file
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const formData = await request.formData();
	const itemId = formData.get('itemId') as string;
	const language = formData.get('language') as string;
	const mediaType = formData.get('mediaType') as string;
	const file = formData.get('file') as File | null;

	if (!itemId || !language || !file) {
		throw error(400, 'Missing required fields: itemId, language, file');
	}

	const bazarrConfigs = getEnabledConfigs().filter((c) => c.type === 'bazarr');
	if (bazarrConfigs.length === 0) {
		throw error(404, 'No Bazarr service configured');
	}

	const config = bazarrConfigs[0];
	const adapter = registry.get(config.type);

	if (!adapter?.uploadContent) {
		throw error(501, 'Subtitle upload not supported');
	}

	try {
		const blob = new Blob([await file.arrayBuffer()], { type: file.type });
		await adapter.uploadContent(config, itemId, 'subtitle', blob, file.name);
		return json({ success: true });
	} catch (e) {
		console.error('[subtitles/upload] error:', e);
		throw error(502, e instanceof Error ? e.message : 'Upload failed');
	}
};
