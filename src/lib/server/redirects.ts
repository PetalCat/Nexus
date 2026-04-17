// CANONICAL: single source for route redirect rules.
//
// Onboarding, auth, and legacy-URL redirects used to live inline in
// hooks.server.ts alongside rate-limiting, session loading, and header
// hardening. Consolidating them here keeps the precedence order readable
// and makes it obvious which paths are allowlisted vs gated.
//
// Precedence (top wins):
//   1. Legacy URL rewrites (e.g. /collections → /library/catalogs).
//   2. NO_AUTH_PATHS allowlist (login/setup/invite/register/etc).
//   3. First-run redirect: no users at all → /setup.
//   4. For logged-in users:
//        a. forcePasswordReset → /reset-password (locked),
//        b. status='pending'   → /pending-approval (locked),
//        c. !welcomeCompletedAt → /welcome (onboarding).
//   5. For logged-out users on non-API paths → /login?next=<path>.
//
// Returning `null` means "no redirect; let the request through".

import { getUserCount } from '$lib/server/auth';

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
 * prefixes short-circuits the redirect chain and the rate limiter's
 * auth-endpoint tier still applies from hooks.server.ts.
 */
export const NO_AUTH_PATHS = [
	'/login',
	'/setup',
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
 * Resolves the redirect (if any) for a given request.
 *
 * @param user The authenticated user, or null if no valid session.
 * @param path The pathname (no query).
 * @param search The query string, including the leading `?` (or empty).
 */
export function resolveRedirect(
	user: RedirectUser | null,
	path: string,
	search: string = ''
): RedirectTarget | null {
	// 1. Legacy rewrite: /collections → /library/catalogs (2026-04-17).
	//    Disambiguates adapter-sourced catalogs from user/social collections.
	if (path === '/collections' || path.startsWith('/collections/')) {
		const target = '/library/catalogs' + path.slice('/collections'.length);
		return { location: target + (search ?? ''), status: 301 };
	}

	// 2. Allowlisted paths short-circuit — never redirect.
	if (NO_AUTH_PATHS.some((p) => path.startsWith(p))) {
		return null;
	}

	// 3. First-run: no users yet → setup.
	if (getUserCount() === 0) {
		return { location: '/setup', status: 303 };
	}

	// 4. Logged-in users:
	if (user) {
		// API routes skip onboarding/lock redirects — they get JSON 403s
		// instead (see the API gate in hooks.server.ts). Returning null here
		// keeps API calls from being redirected mid-request.
		if (path.startsWith('/api')) {
			return null;
		}

		// 4a. Force password reset — lock to /reset-password.
		if (
			user.forcePasswordReset &&
			!path.startsWith('/reset-password') &&
			!path.startsWith('/api/auth/logout')
		) {
			return { location: '/reset-password', status: 303 };
		}

		// 4b. Pending approval — lock to /pending-approval.
		if (
			user.status === 'pending' &&
			!path.startsWith('/pending-approval') &&
			!path.startsWith('/api/auth/logout')
		) {
			return { location: '/pending-approval', status: 303 };
		}

		// 4c. Welcome flow (first-run per-user, orthogonal to /setup).
		const welcomeCompletedAt = user.welcomeCompletedAt;
		if (
			!welcomeCompletedAt &&
			!path.startsWith('/welcome') &&
			!path.startsWith('/setup') &&
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

	// 5. Unauthenticated: API routes let the endpoint decide; page routes
	//    redirect to /login with the current URL captured in `next`.
	if (path.startsWith('/api')) {
		return null;
	}
	const next = encodeURIComponent(path + (search ?? ''));
	return { location: `/login?next=${next}`, status: 303 };
}
