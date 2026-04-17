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

	it('throws when the env var is missing', () => {
		const saved = process.env.NEXUS_ENCRYPTION_KEY;
		delete process.env.NEXUS_ENCRYPTION_KEY;
		__resetCryptoForTests();
		try {
			expect(() => assertEncryptionKey()).toThrow(/NEXUS_ENCRYPTION_KEY/);
		} finally {
			process.env.NEXUS_ENCRYPTION_KEY = saved;
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
