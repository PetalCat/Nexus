/**
 * AES-256-GCM envelope encryption for at-rest secrets (e.g. stored service
 * passwords used for credential auto-refresh).
 *
 * Format: `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`
 *
 * The version prefix lets us rotate keys / algorithms later without migrating
 * every row up front. Today we only accept/emit `v1`.
 *
 * Key source (in order):
 *   1. `NEXUS_ENCRYPTION_KEY` env var — 64 hex chars or 44-char base64.
 *   2. `<dataDir>/.nexus-encryption-key` — persisted file (0600 perms).
 *   3. Auto-generated on first boot: 32 random bytes written to #2, logged
 *      as a one-time warning. Keeps `docker compose up` a one-line deploy.
 *
 * Operators who want strong key-management SHOULD set the env var; operators
 * who want zero-config get a safe random key persisted to the data dir which
 * is typically the only durable writeable mount. Either way, the same key is
 * used across restarts (never silently rotates), so encrypted rows stay
 * decryptable.
 *
 * Startup policy: `assertEncryptionKey()` must be called during boot. It
 * resolves the key via the fallback chain and throws only if NONE of the
 * three sources is available (e.g. read-only filesystem, hostile env).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

/** Resolve the on-disk key file path from DATABASE_URL's parent dir. */
function keyFilePath(): string {
	const dbPath = process.env.DATABASE_URL ?? './data/nexus.db';
	const dir = dirname(resolve(dbPath));
	return resolve(dir, '.nexus-encryption-key');
}

function getKey(): Buffer {
	if (cachedKey) return cachedKey;

	// 1. Env var takes precedence.
	const raw = process.env.NEXUS_ENCRYPTION_KEY;
	if (raw && raw.trim()) {
		cachedKey = parseKey(raw);
		return cachedKey;
	}

	// 2. Persisted key file in the data dir.
	const path = keyFilePath();
	if (existsSync(path)) {
		const disk = readFileSync(path, 'utf8');
		cachedKey = parseKey(disk);
		return cachedKey;
	}

	// 3. Auto-generate + persist. One-time warning so operators see what
	//    happened and can upgrade to env-var management if they want.
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const generated = randomBytes(KEY_LEN);
	writeFileSync(path, generated.toString('hex') + '\n', { encoding: 'utf8', mode: 0o600 });
	try { chmodSync(path, 0o600); } catch { /* fs may not support chmod */ }
	cachedKey = generated;
	// Loud log so it shows up on first boot. No throw — keeps one-line deploy.
	// eslint-disable-next-line no-console
	console.warn(
		`[crypto] Generated a new NEXUS_ENCRYPTION_KEY at ${path}. ` +
		`Back this file up — losing it invalidates every stored service password. ` +
		`Set the NEXUS_ENCRYPTION_KEY env var to manage the key yourself.`
	);
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
