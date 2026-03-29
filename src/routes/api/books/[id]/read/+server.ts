import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const config = getConfigsForMediaType('book')[0];
	if (!config) throw error(404, 'No Calibre service configured');

	const adapter = registry.get(config.type);
	const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
	const response = await adapter?.downloadContent?.(config, params.id, 'epub', userCred);
	if (!response) throw error(500, 'Download not supported');

	return new Response(response.body, {
		headers: {
			'Content-Type': 'application/epub+zip',
			'Cache-Control': 'private, max-age=86400'
		}
	});
};
