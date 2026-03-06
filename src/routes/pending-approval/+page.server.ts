import { redirect } from '@sveltejs/kit';
import { COOKIE_NAME, validateSession } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const token = cookies.get(COOKIE_NAME);
	const user = validateSession(token);
	if (!user) throw redirect(303, '/login');
	if (user.status !== 'pending') throw redirect(303, '/');
	return {};
};
