// Better Auth — the Nexus identity/session/RBAC layer (Eli: don't roll your own
// auth crypto). Replaces the hand-rolled scrypt+cookie in ../auth.ts. Better Auth
// also defaults to scrypt, so this is not a crypto-philosophy change — it's
// stopping the hand-rolling and gaining RBAC, OIDC (Authentik), 2FA, and session
// revocation (which closes the gen-revocation gap from the security review).
//
// NOTE: not yet wired into hooks.server.ts. Going live needs (next increment):
//  1. `npx @better-auth/cli generate` → emit the Drizzle schema (account +
//     verification tables, role/banned columns) → drizzle-kit migrate.
//  2. Backfill: one `account` row per existing user (providerId 'credential',
//     password = legacy `salt:hash`) — TESTED against a DB copy first so nobody
//     gets locked out.
//  3. Swap hooks to svelteKitHandler + populate locals.user/session from BA.
// The legacy-scrypt verify below means existing users keep their passwords (no
// forced reset); Better Auth rehashes to its format on next successful login.
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { username } from 'better-auth/plugins';
import { genericOAuth } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { verifyPassword as baVerifyPassword } from 'better-auth/crypto';
import { getRequestEvent } from '$app/server';
import { building } from '$app/environment';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb, schema } from '../../db';

// Fail-closed secret validation, independent of NODE_ENV (Better Auth only hard-
// fails on a missing/weak secret when isProduction, otherwise silently signs with
// a PUBLIC default — forgeable sessions). Refuse to start without a real secret.
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
// Runtime-only: `vite build` imports this server module to bundle it, with no
// env present. Don't throw at build (guarded by `building`); the check still
// fail-closes at runtime, where the secret must be set.
if (!building && (!BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < 32)) {
	throw new Error(
		'[auth] BETTER_AUTH_SECRET must be set to a random string of at least 32 characters.'
	);
}

/** Verify a legacy `${salt}:${hash}` scrypt password (the pre-Better-Auth format
 *  from ../auth.ts — scrypt, 64-byte key). Used during migration so existing
 *  users authenticate without a reset; Better Auth rehashes on success. */
export function verifyLegacyScrypt(password: string, stored: string): boolean {
	if (!stored || stored.length < 10) return false;
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) return false;
	const attempt = scryptSync(password, salt, 64);
	const expected = Buffer.from(hash, 'hex');
	return attempt.length === expected.length && timingSafeEqual(attempt, expected);
}

/** Authentik (or any) OIDC, enabled only when configured — generic-oauth plugin. */
const oidcProviders =
	process.env.NEXUS_OIDC_DISCOVERY_URL &&
	process.env.NEXUS_OIDC_CLIENT_ID &&
	process.env.NEXUS_OIDC_CLIENT_SECRET
		? [
				genericOAuth({
					config: [
						{
							providerId: 'authentik',
							discoveryUrl: process.env.NEXUS_OIDC_DISCOVERY_URL,
							clientId: process.env.NEXUS_OIDC_CLIENT_ID,
							clientSecret: process.env.NEXUS_OIDC_CLIENT_SECRET,
							// OIDC requires the openid scope; email/profile populate the
							// user record. Without these the authorize request sends an
							// empty scope and the IdP returns no identity.
							scopes: ['openid', 'email', 'profile'],
							// Our users.username is NOT NULL; OIDC profiles don't carry it
							// by default. Derive it from Authentik's preferred_username
							// (unique), falling back to the email local-part / sub.
							mapProfileToUser: (profile: Record<string, unknown>) => {
								const pu = (profile.preferred_username as string) ?? undefined;
								const email = (profile.email as string) ?? undefined;
								const username = pu ?? email?.split('@')[0] ?? (profile.sub as string);
								const name = (profile.name as string) ?? username;
								return { username, displayUsername: name, name, email };
							}
						}
					]
				})
			]
		: [];

// Skip Better Auth init during `vite build` — betterAuth() opens the DB via
// getDb() and requires the secret, neither of which exist at build time. `auth`
// is only ever used inside request handlers (runtime), so a build-time stub is
// safe; the real instance is created on first server start.
export const auth = building
	? (undefined as unknown as ReturnType<typeof betterAuth>)
	: betterAuth({
	// Map BA's models to our tables explicitly: reuse the existing `users` (keeps
	// all the per-user-state FKs pointing at users.id), and use the DISTINCT
	// `auth_sessions` so BA doesn't clobber the legacy `sessions` during cutover.
	database: drizzleAdapter(getDb(), {
		provider: 'sqlite',
		schema: {
			user: schema.users,
			session: schema.authSessions,
			account: schema.accounts,
			verification: schema.verifications
		}
	}),
	secret: BETTER_AUTH_SECRET,
	// baseURL drives Better Auth's Secure-cookie derivation + CSRF origin check.
	// Set it to the public https URL in prod (BETTER_AUTH_URL); over plain http
	// (dev / behind a TLS-terminating proxy on http) cookies stay non-Secure.
	baseURL: process.env.BETTER_AUTH_URL,
	trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',').map((s) => s.trim()),
	// Link an Authentik (OIDC) login to an existing local account with the same
	// verified email instead of creating a duplicate — Authentik is a trusted IdP.
	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: ['authentik']
		}
	},
	emailAndPassword: {
		enabled: true,
		// Match the existing Nexus register UI policy (6 chars) so client-side
		// validation and Better Auth agree; BA defaults to 8 and would otherwise
		// reject 6–7 char passwords the form accepted.
		minPasswordLength: 6,
		// Password hashing is left to Better Auth (its own scrypt, via
		// better-auth/crypto) — we do NOT override `hash`, so new/registered users
		// get BA-format hashes. Verification must accept BOTH formats: legacy rows
		// migrated from the hand-rolled auth.ts use node scrypt (r=8) while BA's
		// own hashes use different params (r=16); the two are the same `salt:hash`
		// shape but not cross-verifiable. Try BA's native verifier first, then fall
		// back to the legacy scrypt shim. Both are constant-time internally.
		password: {
			verify: async ({ password, hash }: { password: string; hash: string }) => {
				// Reject empty/short hashes outright (callers pass `passwordHash ?? ''`
				// for null-hash OIDC/service users — those must fail closed).
				if (!hash || hash.length < 10) return false;
				try {
					if (await baVerifyPassword({ password, hash })) return true;
				} catch {
					// Not a BA-format hash (or malformed) — fall through to legacy.
				}
				return verifyLegacyScrypt(password, hash);
			}
		}
	},
	// sveltekitCookies MUST be last — its `after` hook copies Better Auth's
	// Set-Cookie onto the SvelteKit request event, so server-side auth.api calls
	// (login/register form actions) set the session cookie without hand-parsing.
	// NOTE: the Better Auth `admin()` plugin is intentionally NOT enabled. The app's
	// RBAC is the `users.isAdmin` column (lightweight, per current design); enabling
	// admin() would expose /api/auth/admin/* (set-role, ban, IMPERSONATE) keyed off a
	// separate `role` column the app doesn't authorize on — a parallel privilege
	// channel. Revisit when RBAC is unified under the lab IAM work.
	plugins: [username(), ...oidcProviders, sveltekitCookies(getRequestEvent)]
});

export type Auth = typeof auth;
