import { fail, redirect } from '@sveltejs/kit';
import { changePassword, validateSession, COOKIE_NAME } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const token = cookies.get(COOKIE_NAME);
	const user = validateSession(token);
	if (!user) throw redirect(303, '/login');
	if (!user.forcePasswordReset) throw redirect(303, '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const token = cookies.get(COOKIE_NAME);
		const user = validateSession(token);
		if (!user) throw redirect(303, '/login');

		const data = await request.formData();
		const password = data.get('password') as string;
		const confirm = data.get('confirm') as string;

		if (!password || password.length < 6) {
			return fail(400, { error: 'Password must be at least 6 characters' });
		}
		if (password !== confirm) {
			return fail(400, { error: 'Passwords do not match' });
		}

		changePassword(user.id, password);
		throw redirect(303, '/');
	}
};
