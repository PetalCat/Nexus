import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { checkAllServices } from '$lib/server/services';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user?.isAdmin) throw redirect(302, '/');

	const health = await checkAllServices();

	return { health };
};
