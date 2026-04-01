import { fail, redirect } from '@sveltejs/kit';
import { COOKIE_NAME, createSession, getSetting, getUserByUsername, getUserCount, verifyPassword } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (getUserCount() === 0) throw redirect(303, '/setup');
	if (locals.user) throw redirect(303, url.searchParams.get('next') || '/');
	const registrationEnabled = getSetting('registration_enabled') === 'true';
	return { registrationEnabled };
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const data = await request.formData();
		const username = (data.get('username') as string)?.trim();
		const password = data.get('password') as string;

		if (!username || !password) {
			return fail(400, { error: 'Username and password are required' });
		}

		const user = getUserByUsername(username);
		if (!user || !verifyPassword(password, user.passwordHash)) {
			return fail(401, { error: 'Invalid username or password' });
		}

		const token = createSession(user.id);
		cookies.set(COOKIE_NAME, token, {
			path: '/',
			httpOnly: true,
			secure: false,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});

		// Pending approval — redirect to waiting page
		if (user.status === 'pending') {
			throw redirect(303, '/pending-approval');
		}

		// Force password reset — redirect before normal flow
		if (user.forcePasswordReset) {
			throw redirect(303, '/reset-password');
		}

		const next = url.searchParams.get('next') || '/';
		throw redirect(303, next);
	}
};
