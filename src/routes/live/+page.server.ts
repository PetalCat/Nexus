import { getAllLiveChannels } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const channels = await getAllLiveChannels(locals.user?.id);
	return { channels };
};
