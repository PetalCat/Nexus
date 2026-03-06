import { json, error } from '@sveltejs/kit';
import { getMusicInstantMix } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401);
	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');
	const tracks = await getMusicInstantMix(locals.user.id, params.id, serviceId);
	return json(tracks);
};
