import { getDashboardFast, getDashboardPersonalized } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;

	// Fast: continue watching + new in library (Jellyfin, local)
	const rows = await getDashboardFast(userId);

	const hero =
		rows.find((r) => r.id === 'continue')?.items[0] ??
		rows.find((r) => r.id === 'new-in-library')?.items[0] ??
		null;

	return {
		rows,
		hero,
		// Slow: StreamyStats personalized recs — streamed, renders when ready
		personalizedRows: getDashboardPersonalized(userId)
	};
};
