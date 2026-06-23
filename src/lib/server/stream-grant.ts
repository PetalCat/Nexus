/**
 * Nexus Phase-0 STREAM CORE — grant-only stream token (Node mint side).
 *
 * The Rust byte-proxy holds the per-backend service credential server-side; the
 * token a browser ever sees carries NO credential — only a sealed, short-lived,
 * session-bound **grant**. This is the CloudFront/Cloudflare signed-URL shape:
 * a leaked URL has no credential to steal, a leaked URL replayed by another
 * user fails the implicit-assertion (user_id) check, and rotating a backend
 * credential never invalidates an outstanding token (the token never references
 * the cred).
 *
 * Crypto: PASETO **v4.local** (XChaCha20-Poly1305 under the hood) via
 * `paseto-ts` (auth70, maintained). NOT `panva/paseto` — that package is
 * archived and never implemented v4.local. The Rust verifier uses `pasetors`,
 * byte-compatible by the shared v4.local + PASERK `k4.local` standard. The
 * lock is a cross-language golden-vector fixture in CI.
 *
 *  - Payload claims (native-validated where applicable):
 *      backend, resource_ref, allowed_hops, exp (RFC3339, native exp check), gen
 *  - Implicit assertions (authenticated into the AEAD tag, never on the wire,
 *    zero size cost — PASETO's documented confused-deputy / multi-tenant
 *    binding mechanism):
 *      { user_id, hop_index, gen }
 *
 * The implicit assertion is serialized with a FIXED key order so the Rust side
 * can reconstruct the exact same bytes (PASETO authenticates the raw assertion
 * bytes — they must match exactly on both sides).
 */
import { encrypt } from 'paseto-ts/v4';
import { hkdfSync } from 'node:crypto';

/** Logical backend ids the proxy can resolve a held cred for. Open set — the
 *  proxy fails closed on any backend it has no held cred for. */
export type StreamBackend = string;

export interface StreamGrant {
	/** Logical backend id (NOT a URL). The proxy resolves the held service cred. */
	backend: StreamBackend;
	/** Opaque item/path ref (Jellyfin ItemId+MediaSourceId, Plex ratingKey+partId,
	 *  Invidious videoId). The proxy resolves it against the held base URL. */
	resource_ref: string;
	/** Per-grant hop key the rewriter MACs emitted child URLs with (reject
	 *  client-supplied URLs). Opaque to the token; carried as a claim. */
	allowed_hops: string;
	/** Absolute expiry as epoch-seconds OR a Date. Short (minutes), slid by
	 *  renegotiation. Converted to an RFC3339 string for the native `exp` claim. */
	exp: number | Date;
	/** The Nexus user this grant was minted for. Bound via implicit assertion. */
	user_id: string;
	/** Per-user generation epoch (logout/disable bump). Both a claim and an
	 *  implicit assertion so a stale gen can be rejected at either layer. */
	gen: number;
	/** Hop index this grant is scoped to (0 = entry). Bound via implicit assertion. */
	hop_index?: number;
}

/** The implicit-assertion shape, serialized with a STABLE key order. */
export interface ImplicitAssertion {
	user_id: string;
	hop_index: number;
	gen: number;
}

/**
 * Canonical serialization of the implicit assertion. Key order is FIXED here
 * and mirrored byte-for-byte by the Rust verifier. PASETO authenticates these
 * raw bytes into the tag; any divergence (key order, spacing) → verify fails.
 */
export function serializeImplicitAssertion(a: ImplicitAssertion): string {
	// Hand-built to guarantee key order + no incidental whitespace. user_id is
	// JSON-string-escaped to stay safe for arbitrary ids.
	return `{"user_id":${JSON.stringify(a.user_id)},"hop_index":${a.hop_index},"gen":${a.gen}}`;
}

function toRfc3339(exp: number | Date): string {
	const d = exp instanceof Date ? exp : new Date(exp * 1000);
	// paseto-ts and pasetors both parse RFC3339; millisecond precision is fine.
	return d.toISOString();
}

/**
 * Mint a PASETO v4.local grant token.
 *
 * @param paserkLocalKey  The k4.local PASERK key string (`k4.local.<b64url>`),
 *                        derived once by `deriveStreamPaserkKey` and injected
 *                        into the Rust child env. Pass the CURRENT key.
 * @param kid             Optional key-id hint placed in the (unencrypted but
 *                        authenticated) footer — drives two-key rotation on the
 *                        Rust side (current vs previous).
 */
export function mintGrant(
	grant: StreamGrant,
	paserkLocalKey: string,
	kid?: string,
	/** TEST-ONLY: allow minting an already-expired token (golden-vector fixture).
	 *  Never set in production — exp is always in the future for a real grant. */
	allowExpiredForTest = false
): string {
	const hop_index = grant.hop_index ?? 0;
	const payload = {
		backend: grant.backend,
		resource_ref: grant.resource_ref,
		allowed_hops: grant.allowed_hops,
		gen: grant.gen,
		// Native exp claim — paseto-ts validates it on decrypt, pasetors via
		// ClaimsValidationRules. RFC3339 string.
		exp: toRfc3339(grant.exp),
	};
	const assertion = serializeImplicitAssertion({
		user_id: grant.user_id,
		hop_index,
		gen: grant.gen,
	});

	return encrypt(paserkLocalKey, payload, {
		assertion,
		// We set exp ourselves; don't let the lib inject iat/exp.
		addIat: false,
		addExp: false,
		// paseto-ts refuses to mint an already-expired payload; the golden-vector
		// fixture needs exactly that, so allow it under the explicit test flag.
		...(allowExpiredForTest ? { validatePayload: false } : {}),
		// Footer carries only a kid hint for rotation (authenticated, not secret).
		...(kid ? { footer: { kid } } : {}),
	});
}

/**
 * Derive a PASERK `k4.local` key string from a raw secret.
 *
 * The dedicated `NEXUS_STREAM_SECRET` (separate from the DB encryption key) is
 * run through HKDF-SHA256 to a 32-byte sub-key, then encoded as the PASERK
 * `k4.local.<base64url>` form `paseto-ts` and `pasetors` both accept. Node
 * derives this once and injects it into the Rust child's env; Rust never
 * re-derives — it just parses the PASERK string.
 *
 * @param secret 32+ bytes of entropy (hex / base64 / raw utf8 all accepted).
 * @param info   HKDF context label — bump to rotate the derived key space.
 */
export function deriveStreamPaserkKey(
	secret: string | Buffer,
	info = 'nexus-stream-paseto-v4-local'
): string {
	const ikm = typeof secret === 'string' ? parseSecret(secret) : secret;
	if (ikm.length < 16) {
		throw new Error('NEXUS_STREAM_SECRET too short (need >= 16 bytes of entropy)');
	}
	// HKDF: empty salt is acceptable here (the IKM is already a high-entropy
	// secret, not a low-entropy password). 32-byte output = a v4.local key.
	const out = hkdfSync('sha256', ikm, Buffer.alloc(0), Buffer.from(info, 'utf8'), 32);
	const keyBytes = Buffer.from(out);
	return 'k4.local.' + base64url(keyBytes);
}

function parseSecret(raw: string): Buffer {
	const t = raw.trim();
	if (/^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0 && t.length >= 32) {
		return Buffer.from(t, 'hex');
	}
	const b64 = Buffer.from(t, 'base64');
	if (b64.length >= 16) return b64;
	return Buffer.from(t, 'utf8');
}

function base64url(buf: Buffer): string {
	return buf
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}
