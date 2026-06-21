/**
 * verifyLegacyScrypt — the migration shim that lets pre-Better-Auth users (whose
 * passwords were hashed by the hand-rolled scrypt in auth.ts) authenticate
 * without a forced reset. These tests pin that a hash produced by the legacy
 * scheme round-trips through the shim, and that the fail-closed guards hold
 * (empty/short/malformed stored values must never validate).
 */

import { describe, it, expect, vi } from 'vitest';

// Must be set BEFORE importing better-auth.ts: it validates BETTER_AUTH_SECRET at
// import (>= 32 chars) and constructs betterAuth({ database: drizzleAdapter(getDb()) }),
// which opens the DB at import time. vi.hoisted runs ABOVE the (hoisted) ESM
// imports — a plain top-level assignment would run too late.
vi.hoisted(() => {
	process.env.DATABASE_URL = `/tmp/nexus-test-legacy-scrypt-${Date.now()}.db`;
	process.env.BETTER_AUTH_SECRET = 'z'.repeat(40);
});

// $app/server is a SvelteKit virtual module with no Node resolution under vitest.
// better-auth.ts imports getRequestEvent from it (only invoked lazily inside the
// sveltekitCookies hook, never at import), so a stub satisfies module load.
vi.mock('$app/server', () => ({ getRequestEvent: () => ({}) }));

import { verifyLegacyScrypt } from '../auth/better-auth';
import { hashPassword } from '../auth';

describe('verifyLegacyScrypt', () => {
	it('round-trips a password hashed with the legacy auth.ts scheme', () => {
		const stored = hashPassword('correct horse battery staple');
		expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
		expect(verifyLegacyScrypt('correct horse battery staple', stored)).toBe(true);
	});

	it('rejects the wrong password', () => {
		const stored = hashPassword('right-password');
		expect(verifyLegacyScrypt('wrong-password', stored)).toBe(false);
	});

	it('is salt-bound: the same password hashed twice gives different stored values, each verifying only itself', () => {
		const a = hashPassword('samepw');
		const b = hashPassword('samepw');
		expect(a).not.toBe(b); // random salt
		expect(verifyLegacyScrypt('samepw', a)).toBe(true);
		expect(verifyLegacyScrypt('samepw', b)).toBe(true);
	});

	it('rejects an empty stored value', () => {
		expect(verifyLegacyScrypt('whatever', '')).toBe(false);
	});

	it('rejects a too-short stored value (the stored.length < 10 guard)', () => {
		// Shorter than 10 chars — fails the length guard before any split/scrypt.
		expect(verifyLegacyScrypt('whatever', 'a:b')).toBe(false);
		expect(verifyLegacyScrypt('whatever', '123456789')).toBe(false); // exactly 9
	});

	it('rejects a malformed value with no colon separator', () => {
		// Long enough to pass the length guard, but no salt:hash split.
		expect(verifyLegacyScrypt('whatever', 'nocolonseparatorhere')).toBe(false);
	});

	it('rejects a value with an empty salt or empty hash half', () => {
		expect(verifyLegacyScrypt('whatever', ':abcdef0123456789')).toBe(false);
		expect(verifyLegacyScrypt('whatever', 'abcdef0123456789:')).toBe(false);
	});

	it('rejects a value whose hash half is the wrong byte length (length-mismatch guard, no throw)', () => {
		const [salt] = hashPassword('pw').split(':');
		// A valid salt but a truncated hash — must fail closed, not throw.
		const truncated = `${salt}:deadbeef`;
		expect(() => verifyLegacyScrypt('pw', truncated)).not.toThrow();
		expect(verifyLegacyScrypt('pw', truncated)).toBe(false);
	});
});
