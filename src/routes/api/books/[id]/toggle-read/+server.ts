import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { toggleReadStatus } from '$lib/adapters/calibre';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const config = getConfigsForMediaType('book')[0];
	if (!config) throw error(404, 'No Calibre service configured');

	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const result = await toggleReadStatus(config, params.id, userCred);
	return json({ ok: true, read: result });
};
