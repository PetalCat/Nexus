import { json, error } from '@sveltejs/kit';
import { getMusicWanted } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const result = await getMusicWanted(locals.user.id);
	return json(result);
};
