// CANONICAL: single source for route redirect + onboarding-lifecycle rules.
//
// Onboarding, auth, and legacy-URL redirects used to live inline across
// hooks.server.ts AND each entry-point route's +page.server.ts (/setup,
// /welcome, /register, /invite, /pending-approval — issue #32). Each surface
// had its own bespoke guard and they drifted. Consolidating the rules here
// keeps the full state machine auditable in ONE place.
//
// Unification update (#24, 2026-04-17): the `/setup` route has been retired.
// Fresh-install admin creation now happens at `/welcome` (same URL as the
// per-user wizard), selected via the route's `needsAdminCreation` load flag.
// Self-hosters see one URL from docker-compose-up through finished onboarding.
//
// State-machine inputs:
//   user:     App.Locals['user'] | RedirectUser | null  (session presence + status)
//   path:     the request pathname
//   search:   query string (for building ?next=)
//   settings: registration_enabled, registration_requires_approval, onboarding_complete
//             (read via getSetting() — the KV table in app_settings)
//   userCount: global install state — 0 means fresh install (→ /welcome)
//
// Precedence (top wins):
//   1. Legacy URL rewrites (e.g. /collections → /library/catalogs).
//   2. First-run: no users yet AND path ≠ /welcome → /welcome.
//   3. Per-entry-point lifecycle gates (before NO_AUTH_PATHS short-circuit):
//        /register           registration disabled → /login
//                            logged-in → /
//        /invite             logged-in → /
//        /pending-approval   no user → /login
//                            user.status !== 'pending' → /
//        /welcome            no user (and userCount > 0) → /login
//   4. NO_AUTH_PATHS allowlist — path short-circuits (null).
//   5. Logged-in lifecycle locks (in order):
//        forcePasswordReset → /reset-password
//        status='pending'   → /pending-approval
//        !welcomeCompletedAt → /welcome
//   6. Logged-out on non-API → /login?next=<path>.
//
// Returning `null` means "no redirect; let the request through".
//
// Route files SHOULD NOT duplicate these gates — they live here. A route
// may still throw redirect() for form-submit success paths (e.g. the welcome
// wizard advancing a step), but NOT for lifecycle checks.

import { getSetting, getUserCount } from '$lib/server/auth';

/**
 * Minimal user shape the resolver needs. Matches the fields read off
 * `validateSession()`'s return (i.e. the raw DB row), not the pared-down
 * `event.locals.user` — because we need `welcomeCompletedAt` which the
 * locals shape intentionally omits.
 */
export interface RedirectUser {
	status: 'active' | 'pending' | string;
	forcePasswordReset: boolean | number | null;
	welcomeCompletedAt?: string | null;
}

/**
 * Paths that never require auth. Kept as a static list so the security
 * surface is auditable in one place. Anything starting with one of these
 * prefixes short-circuits the redirect chain AFTER lifecycle gates have run.
 * Rate limiting still applies from hooks.server.ts.
 *
 * `/welcome` lives here because — post-#24 — it doubles as the fresh-install
 * admin-create page, which must be reachable without a session when
 * userCount===0. The route itself gates which mode it renders; the gating
 * rules for the logged-in wizard phases live in rule 3e / 5c below.
 */
export const NO_AUTH_PATHS = [
	'/login',
	'/welcome',
	'/invite',
	'/register',
	'/pending-approval',
	'/reset-password',
	'/api/ingest/webhook'
] as const;

export interface RedirectTarget {
	/** Target path, including any query string. */
	location: string;
	/** HTTP status — 301 for legacy URL rewrites, 303 for onboarding/auth. */
	status: 301 | 303;
}

/**
 * Optional injection points — default to the live DB helpers, but tests
 * (and any future callers that already have settings loaded) can pass
 * overrides to avoid hitting the DB.
 */
export interface ResolveRedirectOptions {
	getUserCount?: () => number;
	getSetting?: (key: string) => string | null;
}

/**
 * Resolves the redirect (if any) for a given request.
 *
 * @param user The authenticated user, or null if no valid session.
 * @param path The pathname (no query).
 * @param search The query string, including the leading `?` (or empty).
 * @param opts Optional DB-access overrides (tests).
 */
export function resolveRedirect(
	user: RedirectUser | null,
	path: string,
	search: string = '',
	opts: ResolveRedirectOptions = {}
): RedirectTarget | null {
	const readUserCount = opts.getUserCount ?? getUserCount;
	const readSetting = opts.getSetting ?? getSetting;

	// 1. Legacy rewrite: /collections → /library/catalogs (2026-04-17).
	//    Disambiguates adapter-sourced catalogs from user/social collections.
	if (path === '/collections' || path.startsWith('/collections/')) {
		const target = '/library/catalogs' + path.slice('/collections'.length);
		return { location: target + (search ?? ''), status: 301 };
	}

	// 2. First-run global: no users yet → /welcome (everything else bounces
	//    there). The /welcome route renders the admin-create form when
	//    userCount===0 && no session (see its `needsAdminCreation` branch).
	if (readUserCount() === 0) {
		if (!path.startsWith('/welcome')) {
			return { location: '/welcome', status: 303 };
		}
		return null;
	}

	// 3. Per-entry-point lifecycle gates. These run BEFORE the NO_AUTH_PATHS
	//    short-circuit so the 4 onboarding surfaces (/register, /invite,
	//    /pending-approval, /welcome) are gated consistently from one place.

	// 3a. /register — gated by app_settings.registration_enabled. Already-
	//     logged-in users bounce home (registering a second account makes
	//     no sense from a signed-in session).
	if (path === '/register' || path.startsWith('/register/')) {
		if (user) {
			return { location: '/', status: 303 };
		}
		if (readSetting('registration_enabled') !== 'true') {
			return { location: '/login', status: 303 };
		}
		return null;
	}

	// 3b. /invite — token-bearing URL. Logged-in users bounce home; anonymous
	//     users always get through (the page itself validates the code and
	//     renders "invalid/expired" if the token is bad).
	if (path === '/invite' || path.startsWith('/invite/')) {
		if (user) {
			return { location: '/', status: 303 };
		}
		return null;
	}

	// 3c. /pending-approval — must be a logged-in user with status='pending'.
	//     Anonymous users → /login; approved users → / (they no longer belong
	//     here). This is the inverse of rule 5b below; keeping both lets the
	//     resolver be a true bidirectional state machine.
	if (path === '/pending-approval' || path.startsWith('/pending-approval/')) {
		if (!user) {
			return { location: '/login', status: 303 };
		}
		if (user.status !== 'pending') {
			return { location: '/', status: 303 };
		}
		return null;
	}

	// 3d. /welcome — per-user first-run wizard (and, when userCount===0 was
	//     handled above in rule 2, the fresh-install admin-create form). Now
	//     that users exist, anonymous visitors bounce to /login. The
	//     already-completed + !?force=1 check stays in the route itself,
	//     because it needs to read welcome_completed_at from the DB fresh and
	//     the resolver already has a general "welcome for incomplete users"
	//     rule in step 5c.
	if (path === '/welcome' || path.startsWith('/welcome/')) {
		if (!user) {
			return { location: '/login', status: 303 };
		}
		return null;
	}

	// 4. Other allowlisted paths short-circuit — never redirect.
	if (NO_AUTH_PATHS.some((p) => path.startsWith(p))) {
		return null;
	}

	// 5. Logged-in users on gated paths:
	if (user) {
		// API routes skip onboarding/lock redirects — they get JSON 403s
		// instead (see the API gate in hooks.server.ts). Returning null here
		// keeps API calls from being redirected mid-request.
		if (path.startsWith('/api')) {
			return null;
		}

		// 5a. Force password reset — lock to /reset-password.
		if (
			user.forcePasswordReset &&
			!path.startsWith('/reset-password') &&
			!path.startsWith('/api/auth/logout')
		) {
			return { location: '/reset-password', status: 303 };
		}

		// 5b. Pending approval — lock to /pending-approval.
		if (
			user.status === 'pending' &&
			!path.startsWith('/pending-approval') &&
			!path.startsWith('/api/auth/logout')
		) {
			return { location: '/pending-approval', status: 303 };
		}

		// 5c. Welcome flow (first-run per-user). /setup was folded into
		//     /welcome in #24, so it no longer needs its own exemption.
		const welcomeCompletedAt = user.welcomeCompletedAt;
		if (
			!welcomeCompletedAt &&
			!path.startsWith('/welcome') &&
			!path.startsWith('/login') &&
			!path.startsWith('/logout') &&
			!path.startsWith('/api/auth/logout') &&
			!path.startsWith('/reset-password') &&
			!path.startsWith('/_app') &&
			path !== '/favicon.ico'
		) {
			return { location: '/welcome', status: 303 };
		}

		return null;
	}

	// 6. Unauthenticated: API routes let the endpoint decide; page routes
	//    redirect to /login with the current URL captured in `next`.
	if (path.startsWith('/api')) {
		return null;
	}
	const next = encodeURIComponent(path + (search ?? ''));
	return { location: `/login?next=${next}`, status: 303 };
}
