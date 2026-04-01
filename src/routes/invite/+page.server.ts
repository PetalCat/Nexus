import { fail, redirect } from '@sveltejs/kit';
import {
	COOKIE_NAME,
	createSession,
	createUser,
	validateInviteCode,
	consumeInviteCode,
	validateSession
} from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, cookies }) => {
	const code = url.searchParams.get('code') ?? '';

	// If already logged in, go to home
	const token = cookies.get(COOKIE_NAME);
	const user = validateSession(token);
	if (user) throw redirect(303, '/');

	if (!code) {
		return { valid: false, error: 'No invite code provided' };
	}

	const invite = validateInviteCode(code);
	if (!invite) {
		return { valid: false, error: 'This invite link is invalid or has expired' };
	}

	return { valid: true, code };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const code = (data.get('code') as string)?.trim();
		const username = (data.get('username') as string)?.trim();
		const displayName = (data.get('displayName') as string)?.trim();
		const password = data.get('password') as string;
		const confirm = data.get('confirm') as string;

		if (!code) {
			return fail(400, { error: 'Missing invite code' });
		}

		const invite = validateInviteCode(code);
		if (!invite) {
			return fail(400, { error: 'This invite link is invalid or has expired' });
		}

		if (!username || !displayName || !password) {
			return fail(400, { error: 'All fields are required' });
		}
		if (password.length < 6) {
			return fail(400, { error: 'Password must be at least 6 characters' });
		}
		if (password !== confirm) {
			return fail(400, { error: 'Passwords do not match' });
		}

		try {
			const userId = createUser(username, displayName, password, false);
			consumeInviteCode(code);

			const token = createSession(userId);
			cookies.set(COOKIE_NAME, token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: false, // set true in production behind HTTPS
				maxAge: 30 * 86_400
			});

			throw redirect(303, '/');
		} catch (e) {
			// Re-throw redirects
			if (e && typeof e === 'object' && 'status' in e) throw e;

			const msg = String(e);
			if (msg.includes('UNIQUE')) {
				return fail(400, { error: 'Username already taken' });
			}
			return fail(500, { error: 'Failed to create account' });
		}
	}
};
