import { fail, redirect } from '@sveltejs/kit';
import {
	getSetting,
	getUserByUsername
} from '$lib/server/auth';
import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import { auth } from '$lib/server/auth/better-auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Lifecycle gates (registration-disabled → /login, already-logged-in → /)
	// live in resolveRedirect (#32).
	const authServices: Array<{ id: string; name: string; type: string }> = [];
	return { authServices };
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const actions: Actions = {
	default: async ({ request }) => {
		if (getSetting('registration_enabled') !== 'true') {
			return fail(403, { error: 'Registration is disabled' });
		}

		const data = await request.formData();
		const authType = data.get('authType') as string | null;

		if (authType === 'service') {
			return fail(400, { error: 'Service registration is not available in this build' });
		}

		// ── Local registration ──────────────────────────────────────────────
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

		// Create the local account through Better Auth (Eli: don't roll your own
		// auth crypto). signUpEmail creates the user + a 'credential' account row
		// (so the user can later sign in via BA) and sets the session cookie via
		// the sveltekitCookies plugin. Nexus has no email field, so synthesize a
		// stable local one from the username (matches the migration backfill).
		const email = `${username.toLowerCase()}@nexus.local`;
		let createdId: string | undefined;
		try {
			const res = await auth.api.signUpEmail({
				body: { email, password, username, name: displayName, displayUsername: displayName },
				headers: request.headers
			});
			createdId = res?.user?.id;
		} catch (e) {
			// BA throws an APIError (status 422/400) on a duplicate username/email.
			const msg = e instanceof Error ? e.message : String(e);
			if (/exist|taken|unique|duplicate/i.test(msg)) {
				return fail(400, { error: 'Username already taken' });
			}
			return fail(500, { error: 'Failed to create account' });
		}

		// Patch the row by the id returned from sign-up (NOT a re-query by username:
		// the username plugin lowercases the stored username, so a raw-case lookup
		// would miss and silently skip these updates — including the pending gate).
		// (1) Mirror the legacy display_name column (BA only sets `name`/username),
		//     so every display_name reader has a non-null value. (2) Apply the Nexus
		//     approval gate BA doesn't model: flip status to 'pending' when required,
		//     and the hooks redirect resolver routes the (signed-in) user to
		//     /pending-approval until an admin approves.
		const newId = createdId ?? getUserByUsername(username.toLowerCase())?.id;
		if (newId) {
			getDb()
				.update(schema.users)
				.set({ displayName, ...(requiresApproval ? { status: 'pending' } : {}) })
				.where(eq(schema.users.id, newId))
				.run();
		}

		if (requiresApproval) {
			throw redirect(303, '/pending-approval');
		}

		throw redirect(303, '/');
	}
};
