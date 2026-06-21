#!/usr/bin/env node
/**
 * Cross-language golden-vector minter (CI gate). Mints PASETO v4.local grant
 * tokens with the Node `paseto-ts` side using a FIXED k4.local key, so the Rust
 * `pasetors` side can prove byte-compatibility: verify + reconstruct the grant,
 * and reject tampered / expired / wrong-user tokens.
 *
 * Emits a JSON fixture to stream-proxy/tests/fixtures/golden-vector.json that
 * the Rust `cargo test golden_vector` consumes. Re-run to regenerate after any
 * change to the mint/serialize logic:
 *
 *   node scripts/mint-golden-vector.mjs
 *
 * The fixed key is TEST-ONLY (bytes 1..=32). Production keys come from
 * NEXUS_STREAM_SECRET via HKDF (see src/lib/server/stream-grant.ts).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mintGrant, serializeImplicitAssertion } from '../src/lib/server/stream-grant.ts';

// Fixed 32-byte key → PASERK k4.local (bytes 1..=32).
const keyBytes = Buffer.alloc(32);
for (let i = 0; i < 32; i++) keyBytes[i] = i + 1;
function b64url(buf) {
	return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const paserk = 'k4.local.' + b64url(keyBytes);

const baseGrant = {
	backend: 'jellyfin',
	resource_ref: 'item123/src456',
	allowed_hops: 'hopkey-abc',
	user_id: 'user-001',
	gen: 7,
	hop_index: 0,
};

// 1. Valid token, far-future exp.
const validExp = '2099-01-01T00:00:00.000Z';
const validToken = mintGrant({ ...baseGrant, exp: new Date(validExp) }, paserk, 'k0');

// 2. Expired token (past exp).
const expiredToken = mintGrant(
	{ ...baseGrant, exp: new Date('2000-01-01T00:00:00.000Z') },
	paserk,
	'k0',
	true /* allowExpiredForTest */
);

// 3. Tampered: flip one base64 char in the valid token body.
function tamper(tok) {
	const chars = tok.split('');
	// Flip a char in the encrypted-body region (after "v4.local.").
	const i = 'v4.local.'.length + 5;
	chars[i] = chars[i] === 'A' ? 'B' : 'A';
	return chars.join('');
}
const tamperedToken = tamper(validToken);

const fixture = {
	comment:
		'Golden vector: Node paseto-ts mints, Rust pasetors must verify/reconstruct + reject tamper/expired/wrong-user. Fixed test key = bytes 1..=32.',
	paserk_local_key: paserk,
	key_bytes: Array.from(keyBytes),
	expected_user_id: baseGrant.user_id,
	expected_hop_index: baseGrant.hop_index,
	expected_gen: baseGrant.gen,
	expected_implicit_assertion: serializeImplicitAssertion({
		user_id: baseGrant.user_id,
		hop_index: baseGrant.hop_index,
		gen: baseGrant.gen,
	}),
	expected_claims: {
		backend: baseGrant.backend,
		resource_ref: baseGrant.resource_ref,
		allowed_hops: baseGrant.allowed_hops,
		gen: baseGrant.gen,
		exp: validExp,
	},
	valid_token: validToken,
	expired_token: expiredToken,
	tampered_token: tamperedToken,
	wrong_user_id: 'user-EVIL',
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(__dirname, '../stream-proxy/tests/fixtures/golden-vector.json');
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n');
console.log('wrote', out);
console.log('valid token:', validToken.slice(0, 40) + '...');
