import { json, error } from '@sveltejs/kit';
import { getMusicQueue } from '$lib/server/music';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const queue = await getMusicQueue();
	return json(queue);
};
