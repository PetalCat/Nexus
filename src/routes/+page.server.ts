import { getDashboard } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const rows = await getDashboard();

	// Pick a hero item from continue watching or recently added
	const hero =
		rows.find((r) => r.id === 'continue')?.items[0] ??
		rows.find((r) => r.id === 'recently-added')?.items[0] ??
		null;

	return { rows, hero };
};
