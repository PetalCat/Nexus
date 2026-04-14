/**
 * Shared auth-error taxonomy for all Nexus adapters.
 *
 * Every adapter method that talks to an authenticated endpoint MUST throw
 * AdapterAuthError (with a specific `kind`) when it encounters an auth-related
 * failure. Generic Error is reserved for non-auth problems.
 *
 * Consuming routes catch AdapterAuthError specifically and route to the
 * stale-credential UI flow. See docs/superpowers/specs/2026-04-14-adapter-
 * contract-design.md for the contract rules.
 */

export type AdapterAuthErrorKind =
	/** Session/token died. Retry after refreshCredential() succeeds. */
	| 'expired'
	/** Credentials are outright wrong — stored password no longer works. */
	| 'invalid'
	/** Service is rate-limiting us. Honor retryAfterMs if provided. */
	| 'rate-limited'
	/** User tried to create an account but the service blocks registration. */
	| 'registration-disabled'
	/** Network/timeout/DNS failure — couldn't reach the service at all. */
	| 'unreachable'
	/** Authed successfully but lacks the required role/permission. */
	| 'permission-denied'
	/** A derived credential's parent is stale — reconnect the parent first. */
	| 'parent-stale';

export class AdapterAuthError extends Error {
	constructor(
		message: string,
		public readonly kind: AdapterAuthErrorKind,
		public readonly retryAfterMs?: number
	) {
		super(message);
		this.name = 'AdapterAuthError';
	}

	/** Type-guard helper for catch blocks. */
	static is(err: unknown): err is AdapterAuthError {
		return err instanceof AdapterAuthError;
	}
}
