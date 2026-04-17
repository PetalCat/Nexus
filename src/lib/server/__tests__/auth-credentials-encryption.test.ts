import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the DB at a fresh tmp file BEFORE importing any DB modules so we don't
// stomp the dev DB.
const testDbDir = mkdtempSync(join(tmpdir(), 'nexus-auth-enc-'));
process.env.DATABASE_URL = join(testDbDir, 'test.db');
process.env.NEXUS_ENCRYPTION_KEY = 'a'.repeat(64);

// Import lazily so env is set first.
let upsertUserCredential: typeof import('../auth').upsertUserCredential;
let getDb: typeof import('../../db').getDb;
let schema: typeof import('../../db').schema;

describe('upsertUserCredential encrypts stored_password at rest', () => {
	beforeAll(async () => {
		const authMod = await import('../auth');
		upsertUserCredential = authMod.upsertUserCredential;
		const dbMod = await import('../../db');
		getDb = dbMod.getDb;
		schema = dbMod.schema;

		// Run the drizzle migrations so the schema exists.
		const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
		migrate(getDb(), { migrationsFolder: 'drizzle' });

		// Seed a user + service so FK constraints (if any) don't block the test.
		const db = getDb();
		db.insert(schema.users)
			.values({
				id: 'u-enc',
				username: 'enc',
				displayName: 'Enc',
				passwordHash: 'x',
				isAdmin: false,
				authProvider: 'local',
				status: 'active',
				forcePasswordReset: false
			})
			.run();
		db.insert(schema.services)
			.values({
				id: 's-enc',
				type: 'jellyfin',
				name: 'Test',
				url: 'http://localhost',
				enabled: true
			})
			.run();
	});

	beforeEach(() => {
		const db = getDb();
		db.delete(schema.userServiceCredentials).run();
	});

	it('persists encrypted ciphertext, not plaintext', () => {
		upsertUserCredential('u-enc', 's-enc', {
			accessToken: 'tok',
			storedPassword: 'hunter2'
		}, { skipDerivedLink: true });

		const db = getDb();
		const row = db.select().from(schema.userServiceCredentials).get();
		expect(row).toBeTruthy();
		expect(row!.storedPassword).not.toBe('hunter2');
		expect(row!.storedPassword!.startsWith('v1:')).toBe(true);
	});

	it('produces a different envelope each call (random IV)', () => {
		upsertUserCredential('u-enc', 's-enc', { storedPassword: 'same' }, { skipDerivedLink: true });
		const db = getDb();
		const first = db.select().from(schema.userServiceCredentials).get()!.storedPassword!;
		db.delete(schema.userServiceCredentials).run();
		upsertUserCredential('u-enc', 's-enc', { storedPassword: 'same' }, { skipDerivedLink: true });
		const second = db.select().from(schema.userServiceCredentials).get()!.storedPassword!;
		expect(first).not.toBe(second);
	});

	it('null storedPassword passes through without encryption', () => {
		upsertUserCredential('u-enc', 's-enc', {
			accessToken: 'tok',
			storedPassword: null
		}, { skipDerivedLink: true });
		const db = getDb();
		const row = db.select().from(schema.userServiceCredentials).get();
		expect(row!.storedPassword).toBeNull();
	});
});

// cleanup — best-effort.
process.on('exit', () => {
	try {
		rmSync(testDbDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});
