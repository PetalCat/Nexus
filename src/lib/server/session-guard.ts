/**
 * Canonical per-request authorization helpers.
 *
 * Replaces the ad-hoc `if (!locals.user) throw error(401, 'Unauthorized')`
 * scattered across API routes. `requireActiveUser` also closes the hole where
 * `status='pending'` or `forcePasswordReset=true` users can call API routes
 * (issue #7) — hooks.server.ts only guards page routes for those states.
 *
 * Failure mode: SvelteKit's `error()` returns a plain 401/403; we additionally
 * attach an `X-Nexus-Reason` header (via `HttpError`'s `body.nexusReason`) for
 * the client. SvelteKit's error() body ends up in the response body, so we
 * encode the reason there; any API caller that cares can read it and map to
 * UI copy.
 */

import { error, type HttpError } from '@sveltejs/kit';

export interface AuthUser {
	id: string;
	username: string;
	displayName: string;
	avatar: string | null;
	isAdmin: boolean;
	status: 'active' | 'pending';
	forcePasswordReset: boolean;
}

/** Minimal shape we need — an event or a `{ locals }` subset both work. */
export interface LocalsLike {
	locals: App.Locals;
}

/**
 * Throws a SvelteKit error and tags it with a `nexusReason` field so handlers
 * that want to set the `X-Nexus-Reason` header in a custom error-handler can
 * still extract it.
 */
function throwReasoned(
	status: number,
	message: string,
	reason: string
): never {
	// The body shape shows up as the error's `body` in hooks/handleError.
	const err = error(status, { message, nexusReason: reason } as unknown as App.Error);
	// Types think `error()` returns `HttpError`, but it actually throws.
	// Re-throw here just so the `never` contract holds for callers.
	throw err as unknown as HttpError;
}

/**
 * Asserts there is a logged-in user; returns the AuthUser. 401 if not.
 * Use this for routes that should be reachable by pending/locked users
 * (e.g. `/api/auth/logout`, `/api/auth/reset-password`).
 */
export function requireUser(event: LocalsLike): AuthUser {
	const user = event.locals.user;
	if (!user) throwReasoned(401, 'Unauthorized', 'no-session');
	return user;
}

/**
 * Asserts there is a logged-in user whose account is fully active:
 *   - session exists (401 otherwise)
 *   - `status !== 'pending'` (403 with `pending-approval` otherwise)
 *   - `forcePasswordReset !== true` (403 with `password-reset-required` otherwise)
 *
 * This is the default gate for all API routes that read or mutate real data.
 */
export function requireActiveUser(event: LocalsLike): AuthUser {
	const user = event.locals.user;
	if (!user) throwReasoned(401, 'Unauthorized', 'no-session');
	if (user.status === 'pending') {
		throwReasoned(403, 'Account pending approval', 'pending-approval');
	}
	if (user.forcePasswordReset) {
		throwReasoned(403, 'Password reset required', 'password-reset-required');
	}
	return user;
}

/**
 * Asserts there is a logged-in, active, admin user. 401/403 as appropriate.
 */
export function requireAdmin(event: LocalsLike): AuthUser {
	const user = requireActiveUser(event);
	if (!user.isAdmin) throwReasoned(403, 'Admin only', 'not-admin');
	return user;
}
