import { getAllLiveChannels } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	if (!locals.user) return { channels: [], guide: null };

	const [channels, guideRes] = await Promise.all([
		getAllLiveChannels(locals.user.id),
		fetch('/api/live/guide')
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null)
	]);

	return { channels, guide: guideRes?.guide ?? null };
};
