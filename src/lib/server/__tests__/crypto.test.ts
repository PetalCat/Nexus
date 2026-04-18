import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
	encryptAtRest,
	decryptAtRest,
	encryptStoredPassword,
	decryptStoredPassword,
	assertEncryptionKey,
	__resetCryptoForTests
} from '../crypto';

// 32 bytes hex (random-looking but fixed for determinism).
const TEST_KEY = 'a'.repeat(64);

describe('crypto (AES-256-GCM envelope)', () => {
	beforeAll(() => {
		process.env.NEXUS_ENCRYPTION_KEY = TEST_KEY;
	});

	beforeEach(() => {
		__resetCryptoForTests();
	});

	it('assertEncryptionKey passes with a valid hex key', () => {
		expect(() => assertEncryptionKey()).not.toThrow();
	});

	it('auto-generates and persists a key when the env var is missing', () => {
		// Behavior change (codex round 8 followup): missing env is no longer a
		// hard-fail. Nexus auto-generates a key to `<dataDir>/.nexus-encryption-key`
		// on first boot so docker-compose-up still works as a one-line deploy.
		const saved = process.env.NEXUS_ENCRYPTION_KEY;
		const savedDb = process.env.DATABASE_URL;
		delete process.env.NEXUS_ENCRYPTION_KEY;
		// Point DATABASE_URL at a tmp dir so the auto-gen writes somewhere safe.
		const { mkdtempSync, existsSync, rmSync } = require('node:fs') as typeof import('node:fs');
		const { tmpdir } = require('node:os') as typeof import('node:os');
		const { resolve } = require('node:path') as typeof import('node:path');
		const dir = mkdtempSync(resolve(tmpdir(), 'nexus-crypto-test-'));
		process.env.DATABASE_URL = resolve(dir, 'test.db');
		__resetCryptoForTests();
		try {
			expect(() => assertEncryptionKey()).not.toThrow();
			expect(existsSync(resolve(dir, '.nexus-encryption-key'))).toBe(true);
		} finally {
			process.env.NEXUS_ENCRYPTION_KEY = saved;
			if (savedDb === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = savedDb;
			rmSync(dir, { recursive: true, force: true });
			__resetCryptoForTests();
		}
	});

	it('round-trips a plaintext', () => {
		const blob = encryptAtRest('hunter2');
		expect(blob.startsWith('v1:')).toBe(true);
		expect(blob).not.toContain('hunter2');
		expect(decryptAtRest(blob)).toBe('hunter2');
	});

	it('produces a different envelope per call (random IV)', () => {
		const a = encryptAtRest('same');
		const b = encryptAtRest('same');
		expect(a).not.toBe(b);
		expect(decryptAtRest(a)).toBe('same');
		expect(decryptAtRest(b)).toBe('same');
	});

	it('null passes through both paths', () => {
		expect(decryptAtRest(null)).toBeNull();
		expect(decryptStoredPassword(null)).toBeNull();
		expect(encryptStoredPassword(null)).toBeNull();
	});

	it('undefined passes through the stored-password helper', () => {
		expect(encryptStoredPassword(undefined)).toBeUndefined();
		expect(decryptStoredPassword(undefined)).toBeNull();
	});

	it('rejects an unknown version prefix', () => {
		expect(() => decryptAtRest('v99:aa:bb:cc')).toThrow(/unsupported version/);
	});

	it('rejects a malformed envelope', () => {
		expect(() => decryptAtRest('nope')).toThrow(/malformed envelope/);
	});

	it('detects tampering via the GCM auth tag', () => {
		const blob = encryptAtRest('secret');
		const [version, iv, tag, ctRaw] = blob.split(':');
		// Flip the last byte of the ciphertext.
		const ctBuf = Buffer.from(ctRaw, 'base64');
		ctBuf[ctBuf.length - 1] ^= 0xff;
		const tampered = `${version}:${iv}:${tag}:${ctBuf.toString('base64')}`;
		expect(() => decryptAtRest(tampered)).toThrow();
	});
});
