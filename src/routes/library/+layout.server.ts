import { redirect } from '@sveltejs/kit';
import { getUnseenShareCount } from '$lib/server/social';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) throw redirect(302, '/login');

	// Redirect /library to /library/watchlist
	if (url.pathname === '/library' || url.pathname === '/library/') {
		throw redirect(302, '/library/watchlist');
	}

	const unseenShares = getUnseenShareCount(locals.user.id);
	return { unseenShares };
};
