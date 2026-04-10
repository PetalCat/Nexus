import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { getProviderStatus, resetProviders } from '$lib/adapters/bazarr';

/**
 * GET /api/admin/subtitles/providers
 *
 * Returns subtitle provider status from Bazarr (active, throttled, error).
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.isAdmin) throw error(403, 'Admin only');

	const bazarrConfigs = getEnabledConfigs().filter((c) => c.type === 'bazarr');
	if (bazarrConfigs.length === 0) {
		return json({ providers: [] });
	}

	const config = bazarrConfigs[0];
	const providers = await getProviderStatus(config);
	return json({ providers });
};

/**
 * POST /api/admin/subtitles/providers
 *
 * Reset throttled subtitle providers.
 * Body: { action: 'reset' }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) throw error(403, 'Admin only');

	const body = await request.json();
	if (body.action !== 'reset') {
		throw error(400, 'Invalid action');
	}

	const bazarrConfigs = getEnabledConfigs().filter((c) => c.type === 'bazarr');
	if (bazarrConfigs.length === 0) {
		throw error(404, 'No Bazarr service configured');
	}

	const config = bazarrConfigs[0];

	try {
		await resetProviders(config);
		return json({ success: true });
	} catch (e) {
		console.error('[admin/subtitles/providers] reset error:', e);
		throw error(502, e instanceof Error ? e.message : 'Reset failed');
	}
};
