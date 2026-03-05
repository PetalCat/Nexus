import { getDashboard } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const rows = await getDashboard(locals.user?.id);

	// Pick a hero item from continue watching or new in library
	const hero =
		rows.find((r) => r.id === 'continue')?.items[0] ??
		rows.find((r) => r.id === 'new-in-library')?.items[0] ??
		null;

	return { rows, hero };
};
