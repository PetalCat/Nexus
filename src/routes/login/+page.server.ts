import { fail, redirect } from '@sveltejs/kit';
import { getSetting } from '$lib/server/auth';
import { auth } from '$lib/server/auth/better-auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	// Fresh-install (userCount===0) + logged-in-user redirects both live in
	// resolveRedirect (#32). This load only runs when we should render login.
	if (locals.user) throw redirect(303, url.searchParams.get('next') || '/');
	const registrationEnabled = getSetting('registration_enabled') === 'true';
	const authServices: Array<{ id: string; name: string; type: string }> = [];

	return { registrationEnabled, authServices };
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const actions: Actions = {
	default: async ({ request, url }) => {
		const data = await request.formData();
		const authType = data.get('authType') as string | null;

		if (authType === 'service') {
			return fail(400, { error: 'Service sign-in is not available in this build' });
		}

		// ── Local authentication (Better Auth) ──────────────────────────────
		// Password verification + session minting goes through Better Auth (Eli:
		// don't roll your own auth crypto). The legacy scrypt hash is honored via
		// the verify shim in better-auth.ts, and BA rehashes to its format on the
		// first successful login. The session cookie is set by the sveltekitCookies
		// plugin. Pending/forcePasswordReset are re-enforced on the next request by
		// the redirect resolver + API gate in hooks.server.ts, so they don't need to
		// be checked here.
		const username = (data.get('username') as string)?.trim();
		const password = data.get('password') as string;

		if (!username || !password) {
			return fail(400, { error: 'Username and password are required' });
		}

	try {
			await (auth.api as any).signInUsername({
				body: { username, password },
				headers: request.headers
			});
		} catch {
			return fail(401, { error: 'Invalid username or password' });
		}

		const next = url.searchParams.get('next') || '/';
		throw redirect(303, next);
	}
};
