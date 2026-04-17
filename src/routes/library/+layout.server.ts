import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, parent }) => {
	if (!locals.user) throw redirect(302, '/login');

	// Redirect /library to /library/watchlist
	if (url.pathname === '/library' || url.pathname === '/library/') {
		throw redirect(302, '/library/watchlist');
	}

	// unseenShares now lives on the root layout so the badge renders everywhere;
	// re-expose via parent() for any child routes that still read data.unseenShares.
	const { unseenShares } = await parent();
	return { unseenShares };
};
