/**
 * AES-256-GCM envelope encryption for at-rest secrets (e.g. stored service
 * passwords used for credential auto-refresh).
 *
 * Format: `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`
 *
 * The version prefix lets us rotate keys / algorithms later without migrating
 * every row up front. Today we only accept/emit `v1`.
 *
 * Key source: `NEXUS_ENCRYPTION_KEY` env var. Must be a 32-byte key expressed
 * as either 64 hex chars or a 44-char base64 string (`openssl rand -hex 32`
 * works). Read lazily on first use and cached in module scope.
 *
 * Startup policy: `assertEncryptionKey()` must be called during `hooks.server.ts`
 * boot; it throws a readable error if the env var is missing or malformed so
 * operators fail loud instead of silently storing plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit IV recommended for GCM
const KEY_LEN = 32;
const VERSION = 'v1';

let cachedKey: Buffer | null = null;

function parseKey(raw: string): Buffer {
	const trimmed = raw.trim();
	// Hex form first (64 chars, 0-9a-fA-F only).
	if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_LEN * 2) {
		return Buffer.from(trimmed, 'hex');
	}
	// Otherwise try base64 (both URL-safe and standard).
	const b64 = Buffer.from(trimmed, 'base64');
	if (b64.length === KEY_LEN) return b64;
	throw new Error(
		`NEXUS_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64). Got ${b64.length} bytes after decode.`
	);
}

function getKey(): Buffer {
	if (cachedKey) return cachedKey;
	const raw = process.env.NEXUS_ENCRYPTION_KEY;
	if (!raw) {
		throw new Error(
			'NEXUS_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and add it to your .env before starting Nexus.'
		);
	}
	cachedKey = parseKey(raw);
	return cachedKey;
}

/**
 * Resets the cached key — test-only. Prod code never mutates the env after
 * boot, so this has no legitimate callers outside vitest.
 */
export function __resetCryptoForTests(): void {
	cachedKey = null;
}

/**
 * Verifies the encryption key is present and valid. Call once at boot.
 * Throws with an actionable message if anything's off.
 */
export function assertEncryptionKey(): void {
	getKey();
}

/**
 * Encrypts a UTF-8 plaintext string. Returns the versioned envelope.
 */
export function encryptAtRest(plaintext: string): string {
	const key = getKey();
	const iv = randomBytes(IV_LEN);
	const cipher = createCipheriv(ALGO, key, iv);
	const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/**
 * Decrypts a previously-encrypted envelope. `null` passes through. Unknown
 * versions throw — we never silently "fall back" to plaintext.
 */
export function decryptAtRest(blob: string | null | undefined): string | null {
	if (blob === null || blob === undefined) return null;
	const parts = blob.split(':');
	if (parts.length !== 4) {
		throw new Error('decryptAtRest: malformed envelope (expected 4 colon-separated parts)');
	}
	const [version, ivB64, tagB64, ctB64] = parts;
	if (version !== VERSION) {
		throw new Error(`decryptAtRest: unsupported version "${version}"`);
	}
	const key = getKey();
	const iv = Buffer.from(ivB64, 'base64');
	const tag = Buffer.from(tagB64, 'base64');
	const ct = Buffer.from(ctB64, 'base64');
	const decipher = createDecipheriv(ALGO, key, iv);
	decipher.setAuthTag(tag);
	const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
	return pt.toString('utf8');
}

/**
 * Convenience: encrypt a stored-password value, passing `null`/`undefined`
 * through unchanged. `undefined` preserves the "leave existing value alone"
 * semantics in `upsertUserCredential`.
 */
export function encryptStoredPassword(plain: string | null | undefined): string | null | undefined {
	if (plain === undefined) return undefined;
	if (plain === null) return null;
	return encryptAtRest(plain);
}

/**
 * Convenience: decrypt a stored-password value, passing `null`/`undefined`
 * through unchanged. Callers that touch raw DB rows go through this at the
 * boundary before handing plaintext to adapters.
 */
export function decryptStoredPassword(
	blob: string | null | undefined
): string | null {
	if (blob === null || blob === undefined) return null;
	return decryptAtRest(blob);
}
