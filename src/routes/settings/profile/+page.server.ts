import type { PageServerLoad } from './$types';
import { getUserById } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	const fullUser = locals.user ? getUserById(locals.user.id) : null;
	return {
		user: fullUser ? {
			id: fullUser.id,
			username: fullUser.username,
			displayName: fullUser.displayName,
			avatar: fullUser.avatar ?? null,
			isAdmin: fullUser.isAdmin,
			createdAt: fullUser.createdAt
		} : null
	};
};
