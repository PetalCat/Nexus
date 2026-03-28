import type { PageServerLoad } from './$types';
import { getMusicWanted, getMusicQueue } from '$lib/server/music';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	if (!userId) return { wanted: { items: [], total: 0 }, queue: [] };

	const [wanted, queue] = await Promise.all([
		getMusicWanted(userId),
		getMusicQueue()
	]);

	return { wanted: wanted ?? { items: [], total: 0 }, queue: queue ?? [] };
};
