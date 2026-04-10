import type { PageServerLoad } from './$types';
import type { CalendarItem } from '$lib/adapters/types';
import { getMissingCategories } from '$lib/server/onboarding';

export const load: PageServerLoad = async ({ fetch, url, locals }) => {
	const days = parseInt(url.searchParams.get('days') ?? '14', 10);
	const res = await fetch(`/api/calendar?days=${days}`);
	const items: CalendarItem[] = res.ok ? await res.json() : [];

	// Group by date for the full calendar page
	const byDate: Record<string, CalendarItem[]> = {};
	for (const item of items) {
		const date = item.releaseDate?.split('T')[0] ?? 'Unknown';
		if (!byDate[date]) byDate[date] = [];
		byDate[date].push(item);
	}

	return { items, byDate, days, missingCategories: locals.user?.isAdmin ? getMissingCategories(['automation']) : [] };
};
