import { describe, it, expect } from 'vitest';
import { decrypt } from 'paseto-ts/v4';
import {
	mintGrant,
	deriveStreamPaserkKey,
	serializeImplicitAssertion,
	type StreamGrant,
} from '$lib/server/stream-grant';

// Fixed test key (bytes 1..=32) → PASERK k4.local, matching the golden vector.
function fixedPaserk(): string {
	const kb = Buffer.alloc(32);
	for (let i = 0; i < 32; i++) kb[i] = i + 1;
	const b64url = kb.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return 'k4.local.' + b64url;
}

const baseGrant: StreamGrant = {
	backend: 'jellyfin',
	resource_ref: 'item123/src456',
	allowed_hops: 'hopkey-abc',
	exp: new Date('2099-01-01T00:00:00.000Z'),
	user_id: 'user-001',
	gen: 7,
	hop_index: 0,
};

describe('serializeImplicitAssertion', () => {
	it('produces a stable, fixed-key-order JSON string', () => {
		expect(serializeImplicitAssertion({ user_id: 'user-001', hop_index: 0, gen: 7 })).toBe(
			'{"user_id":"user-001","hop_index":0,"gen":7}'
		);
	});
	it('escapes the user_id', () => {
		expect(serializeImplicitAssertion({ user_id: 'a"b', hop_index: 1, gen: 2 })).toBe(
			'{"user_id":"a\\"b","hop_index":1,"gen":2}'
		);
	});
});

describe('mintGrant', () => {
	it('mints a v4.local token that round-trips with the matching implicit assertion', () => {
		const key = fixedPaserk();
		const token = mintGrant(baseGrant, key, 'k0');
		expect(token.startsWith('v4.local.')).toBe(true);

		const assertion = serializeImplicitAssertion({ user_id: 'user-001', hop_index: 0, gen: 7 });
		const { payload } = decrypt(key, token, { assertion });
		expect(payload.backend).toBe('jellyfin');
		expect(payload.resource_ref).toBe('item123/src456');
		expect(payload.allowed_hops).toBe('hopkey-abc');
		expect(payload.gen).toBe(7);
		expect(payload.exp).toBe('2099-01-01T00:00:00.000Z');
	});

	it('fails to decrypt with a wrong implicit assertion (user binding)', () => {
		const key = fixedPaserk();
		const token = mintGrant(baseGrant, key, 'k0');
		const wrong = serializeImplicitAssertion({ user_id: 'user-EVIL', hop_index: 0, gen: 7 });
		expect(() => decrypt(key, token, { assertion: wrong })).toThrow();
	});
});

describe('deriveStreamPaserkKey', () => {
	it('derives a stable k4.local PASERK from a secret (HKDF, deterministic)', () => {
		const a = deriveStreamPaserkKey('a'.repeat(64));
		const b = deriveStreamPaserkKey('a'.repeat(64));
		expect(a).toBe(b);
		expect(a.startsWith('k4.local.')).toBe(true);
	});
	it('different secrets derive different keys', () => {
		expect(deriveStreamPaserkKey('a'.repeat(64))).not.toBe(deriveStreamPaserkKey('b'.repeat(64)));
	});
	it('rejects too-short entropy', () => {
		expect(() => deriveStreamPaserkKey('short')).toThrow();
	});
});
