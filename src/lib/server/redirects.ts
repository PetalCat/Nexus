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
	'/api/ingest/webhook',
	'/dev' // design-preview routes (mock data, no real content) — viewable without a session
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
	// Auth + onboarding are now owned entirely by the Authentik outpost + the
	// SSO passthrough in hooks.server.ts. There are no app-owned login/welcome/
	// register/reset routes to redirect to, so this resolver no longer dispatches
	// any redirect. Kept as a no-op shim so callers/imports stay stable.
	return null;
}
