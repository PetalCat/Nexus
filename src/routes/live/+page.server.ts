import { getAllLiveChannels, getConfigsForMediaType } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	if (!locals.user) return { channels: [], guide: null, serviceId: null };

	const [channels, guideRes] = await Promise.all([
		getAllLiveChannels(locals.user.id),
		fetch('/api/live/guide').then((r) => (r.ok ? r.json() : null)).catch(() => null)
	]);

	// Resolve the service ID for streaming URLs
	const configs = getConfigsForMediaType('live');
	const serviceId = configs.length > 0 ? configs[0].id : null;

	return { channels, guide: guideRes?.guide ?? null, serviceId };
};
