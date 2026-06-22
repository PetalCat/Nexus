import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db';

/**
 * Idempotent Better Auth migration: ensure every existing credential user has a
 * matching `accounts` row.
 *
 * The pre-BA auth (../auth.ts) stored each user's scrypt `salt:hash` in
 * `users.password_hash`. Better Auth instead reads the credential password from
 * the `accounts` table (providerId 'credential'), NOT from `users`. So a migrated
 * database has users with a password_hash but no account row — and Better Auth's
 * email/password sign-in finds no credential to verify and the user is locked out.
 *
 * This copies the legacy `salt:hash` verbatim into a credential `accounts` row.
 * better-auth.ts's `password.verify` accepts the legacy scrypt format (it tries
 * BA's own verifier first, then the legacy scrypt shim), so no password reset is
 * needed — users keep their existing passwords.
 *
 * Runs on every boot (after the users-table rebuild in initDb). Idempotent:
 * skips users who already have a credential account, and users with no usable
 * password_hash (OIDC-only / service users — their password lives elsewhere or
 * nowhere). Safe to run repeatedly and on fresh installs (no-op when there are
 * no legacy-password users).
 */
export function backfillCredentialAccounts(): void {
	const db = getDb();
	const users = db
		.select({ id: schema.users.id, hash: schema.users.passwordHash })
		.from(schema.users)
		.all();

	let created = 0;
	const now = new Date();
	for (const u of users) {
		// Mirror better-auth.ts's verify guard: a hash under 10 chars can't be a
		// real salt:hash, so it would never verify — don't manufacture a dead row.
		if (!u.hash || u.hash.length < 10) continue;

		const existing = db
			.select({ id: schema.accounts.id })
			.from(schema.accounts)
			.where(and(eq(schema.accounts.userId, u.id), eq(schema.accounts.providerId, 'credential')))
			.get();
		if (existing) continue;

		db.insert(schema.accounts)
			.values({
				id: randomBytes(16).toString('hex'),
				accountId: u.id, // Better Auth keys credential accounts by the user id
				providerId: 'credential',
				userId: u.id,
				password: u.hash, // legacy salt:hash; verify() accepts it
				createdAt: now,
				updatedAt: now
			})
			.run();
		created++;
	}

	if (created > 0) {
		console.log(`[backfill] Created ${created} credential account row(s) for existing users (Better Auth migration)`);
	}
}
