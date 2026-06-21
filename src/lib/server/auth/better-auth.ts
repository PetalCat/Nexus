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
import { admin, username } from 'better-auth/plugins';
import { genericOAuth } from 'better-auth/plugins';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb } from '../../db';

/** Verify a legacy `${salt}:${hash}` scrypt password (the pre-Better-Auth format
 *  from ../auth.ts — scrypt, 64-byte key). Used during migration so existing
 *  users authenticate without a reset; Better Auth rehashes on success. */
export function verifyLegacyScrypt(password: string, stored: string): boolean {
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
							clientSecret: process.env.NEXUS_OIDC_CLIENT_SECRET
						}
					]
				})
			]
		: [];

export const auth = betterAuth({
	database: drizzleAdapter(getDb(), { provider: 'sqlite', usePlural: true }),
	secret: process.env.BETTER_AUTH_SECRET,
	emailAndPassword: {
		enabled: true,
		// Verify legacy scrypt rows; Better Auth's own scrypt covers new/rehashed
		// passwords. (Returning true here triggers BA's rehash-on-login.)
		password: {
			verify: async ({ password, hash }: { password: string; hash: string }) =>
				verifyLegacyScrypt(password, hash)
		}
	},
	plugins: [username(), admin(), ...oidcProviders]
});

export type Auth = typeof auth;
