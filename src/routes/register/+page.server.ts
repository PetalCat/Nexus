import { fail, redirect } from '@sveltejs/kit';
import { COOKIE_NAME, createSession, createUser, getSetting, validateSession } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	// Registration must be enabled
	if (getSetting('registration_enabled') !== 'true') {
		throw redirect(303, '/login');
	}

	// Already logged in
	const token = cookies.get(COOKIE_NAME);
	const user = validateSession(token);
	if (user) throw redirect(303, '/');

	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		if (getSetting('registration_enabled') !== 'true') {
			return fail(403, { error: 'Registration is disabled' });
		}

		const data = await request.formData();
		const username = (data.get('username') as string)?.trim();
		const displayName = (data.get('displayName') as string)?.trim();
		const password = data.get('password') as string;
		const confirm = data.get('confirm') as string;

		if (!username || !displayName || !password) {
			return fail(400, { error: 'All fields are required' });
		}
		if (password.length < 6) {
			return fail(400, { error: 'Password must be at least 6 characters' });
		}
		if (password !== confirm) {
			return fail(400, { error: 'Passwords do not match' });
		}

		const requiresApproval = getSetting('registration_requires_approval') === 'true';
		const status = requiresApproval ? 'pending' : 'active';

		try {
			const userId = createUser(username, displayName, password, false, { status });
			const token = createSession(userId);
			cookies.set(COOKIE_NAME, token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 30
			});

			if (requiresApproval) {
				throw redirect(303, '/pending-approval');
			}

			throw redirect(303, '/');
		} catch (e) {
			if (e && typeof e === 'object' && 'status' in e) throw e;
			const msg = String(e);
			if (msg.includes('UNIQUE')) {
				return fail(400, { error: 'Username already taken' });
			}
			return fail(500, { error: 'Failed to create account' });
		}
	}
};
