/**
 * /welcome — unified first-run + per-user onboarding (#24).
 *
 * Handles two modes, toggled by global install state:
 *
 *   A. Fresh install (userCount === 0, no session)
 *      → load returns { needsAdminCreation: true, ... }
 *      → page renders an admin-create form
 *      → `createAccount` action creates the first user, opens a session,
 *        and reloads the page — load then falls through to mode B.
 *
 *   B. Normal post-login flow (locals.user present)
 *      → load builds linkableSummaries for the wizard
 *      → page walks welcome → connect → summary phases
 *      → `complete` action sets users.welcomeCompletedAt and redirects home.
 *
 * Unification landed in #24: the old `/setup` route has been retired so
 * self-hosters see one URL (`/welcome`) from docker-compose-up through
 * finished onboarding. Global install state (userCount) and per-user state
 * (welcomeCompletedAt) are still orthogonal — admins pass through /welcome
 * exactly once and can re-enter via ?force=1 from Settings.
 *
 * See docs/superpowers/specs/2026-04-17-surface-drift-fix-plan.md §5.
 */

import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '$lib/db';
import { buildAccountServiceSummariesForType } from '$lib/server/account-services';
import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs } from '$lib/server/services';
import {
	COOKIE_NAME,
	createSession,
	createUser,
	getUserCount
} from '$lib/server/auth';
import type { AccountServiceSummary } from '$lib/components/account-linking/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	// Fresh install: no users yet + no session → render the admin-create form.
	// resolveRedirect (rule 2) has already allowed /welcome through specifically
	// for this case; we skip the logged-in-only gates below.
	if (getUserCount() === 0 && !locals.user) {
		return {
			needsAdminCreation: true as const,
			linkableSummaries: [] as AccountServiceSummary[],
			displayName: 'there',
			isAdmin: false,
			hasAnyServices: false
		};
	}

	// Past this point /welcome requires a session. resolveRedirect already
	// guarantees locals.user is set when userCount > 0 (rule 3e), but narrow
	// for TypeScript and belt-and-braces fallback.
	if (!locals.user) throw redirect(303, '/login');

	// Already completed? Allow force re-run via ?force=1 so users can re-enter
	// the flow from Settings → Linked accounts → "Run onboarding again". This
	// stays in the route because it reads welcome_completed_at fresh from the
	// DB — the resolver only has the cached-at-session-load flag.
	const db = getDb();
	const force = url.searchParams.get('force') === '1';
	const row = db
		.select({ welcomeCompletedAt: schema.users.welcomeCompletedAt })
		.from(schema.users)
		.where(eq(schema.users.id, locals.user.id))
		.get();

	if (!row) throw redirect(303, '/login');
	if (row.welcomeCompletedAt && !force) {
		throw redirect(303, '/');
	}

	// Build summaries for every registered user-linkable service the admin
	// has set up. These become the cards in the wizard's connection step.
	const configs = getEnabledConfigs();
	const linkableSummaries: AccountServiceSummary[] = [];
	for (const config of configs) {
		const adapter = registry.get(config.type);
		if (!adapter?.capabilities?.userAuth?.userLinkable) continue;
		const summaries = buildAccountServiceSummariesForType(locals.user.id, config.type);
		for (const s of summaries) {
			if (s.id === config.id) linkableSummaries.push(s);
		}
	}

	return {
		needsAdminCreation: false as const,
		linkableSummaries,
		displayName: locals.user.displayName ?? locals.user.username ?? 'there',
		// Admin-on-fresh-install needs to configure services before the wizard's
		// personal-account linking step can surface anything. #24 moved admin
		// creation into /welcome but the service-registration step from the
		// retired /setup route was lost — admins landed at "You're all set"
		// without configuring any backends. Codex round 3 P1.
		isAdmin: !!locals.user.isAdmin,
		hasAnyServices: configs.length > 0
	};
};

export const actions: Actions = {
	/**
	 * Fresh-install admin-create action. Mirrors what the retired /setup
	 * route's createAccount action did: create the first user as admin,
	 * open a session cookie, return success so the page reloads into the
	 * normal wizard phases. Guarded to userCount===0 so it can't be used
	 * to elevate-to-admin once the install has a user.
	 */
	createAccount: async ({ request, cookies }) => {
		if (getUserCount() !== 0) {
			return fail(400, {
				error: 'Admin account already exists',
				step: 'account' as const
			});
		}

		const data = await request.formData();
		const username = (data.get('username') as string)?.trim();
		const displayName = (data.get('displayName') as string)?.trim();
		const password = data.get('password') as string;
		const confirm = data.get('confirm') as string;

		if (!username || !displayName || !password) {
			return fail(400, { error: 'All fields are required', step: 'account' as const });
		}
		if (password.length < 6) {
			return fail(400, {
				error: 'Password must be at least 6 characters',
				step: 'account' as const
			});
		}
		if (password !== confirm) {
			return fail(400, { error: 'Passwords do not match', step: 'account' as const });
		}

		let userId: string;
		try {
			userId = createUser(username, displayName, password, true);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes('UNIQUE')) {
				return fail(400, {
					error: 'That username is already taken',
					step: 'account' as const
				});
			}
			return fail(500, { error: 'Failed to create account', step: 'account' as const });
		}

		const token = createSession(userId);
		cookies.set(COOKIE_NAME, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});

		// Redirect back to /welcome — the reload picks up the new session and
		// the load function falls through to the wizard-phase branch.
		throw redirect(303, '/welcome');
	},

	complete: async ({ locals }) => {
		if (!locals.user) throw redirect(303, '/login');
		const db = getDb();
		db.update(schema.users)
			.set({ welcomeCompletedAt: new Date().toISOString() })
			.where(eq(schema.users.id, locals.user.id))
			.run();
		throw redirect(303, '/');
	}
};
