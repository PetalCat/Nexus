//! Grant verification + held-credential resolution — the shared spine both
//! entry routes (`/session` Jellyfin-style, `/v/{id}/...?grant=` Invidious-style)
//! stream through.
//!
//! The token is a PASETO **v4.local** grant. It carries NO credential: only a
//! sealed `{backend, resource_ref, allowed_hops, exp, gen}` payload plus
//! `{user_id, hop_index, gen}` implicit assertions authenticated into the AEAD
//! tag. The proxy HOLDS the per-backend service credential server-side (the
//! `HeldCredTable`, injected by the Node supervisor via env). On a request the
//! flow is:
//!
//!   1. verify the grant (tag + AAD-free + native `exp`) under the current key,
//!      falling back to the previous key for zero-downtime rotation;
//!   2. assert the caller-presented `user_id` matches the implicit assertion the
//!      grant was minted with (copy-paste / confused-deputy defense);
//!   3. resolve the HELD cred for `backend` (unknown backend → fail closed);
//!   4. (caller) resolve the upstream URL and fetch with the held auth header.
//!
//! There is no session store and no per-process secret. The grant IS the
//! session — stateless and restart-proof. The key comes from the env
//! (`NEXUS_STREAM_PASETO_KEY`, PASERK `k4.local`), derived once by Node and
//! never re-derived here.

use core::convert::TryFrom;
use pasetors::keys::SymmetricKey;
use pasetors::token::UntrustedToken;
use pasetors::version4::{LocalToken, V4};
use pasetors::Local;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Which adapter produced this grant. Drives per-server quirks in the HLS
/// rewriter and upstream fetch path. Anything unrecognized = `Generic`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AdapterKind {
    Plex,
    Jellyfin,
    #[default]
    Generic,
}

/// A held service credential for one backend: the upstream base + the auth
/// header the proxy injects upstream. Never travels to the browser.
#[derive(Debug, Clone, Deserialize)]
pub struct HeldCred {
    pub base_url: String,
    pub auth_header_name: String,
    pub auth_header_value: String,
}

/// `backend id -> HeldCred`. Injected by the Node supervisor as
/// `NEXUS_STREAM_HELD_CREDS` (JSON). Resolved fail-closed: an unknown backend
/// yields no cred and the request is rejected.
pub type HeldCredTable = HashMap<String, HeldCred>;

/// The grant payload claims (decrypted from the PASETO token body).
#[derive(Debug, Clone, Deserialize)]
pub struct GrantClaims {
    pub backend: String,
    pub resource_ref: String,
    #[serde(default)]
    pub allowed_hops: String,
    /// RFC3339 string per the v4.local exp claim. Validated natively below.
    pub exp: String,
    // `gen` is a reserved keyword in Rust 2024 — store as `generation`, map the
    // wire claim name `gen` via serde.
    #[serde(default, rename = "gen")]
    pub generation: u64,
}

/// The verified grant: claims + the implicit assertion fields the token was
/// authenticated against. `user_id`/`hop_index`/`gen` come from the implicit
/// assertion the proxy reconstructed and the tag confirmed.
#[derive(Debug, Clone)]
pub struct VerifiedGrant {
    pub claims: GrantClaims,
    pub user_id: String,
    pub hop_index: u64,
    pub generation: u64,
}

/// Why a grant failed to verify. Callers map all of these to a 403 — the
/// variant is for logging only, never surfaced to the client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifyError {
    /// AEAD tag / structural / decrypt failure under every configured key.
    BadToken,
    /// Decrypted fine but the body wasn't a well-formed grant.
    BadClaims,
    /// Native `exp` is in the past.
    Expired,
}

// ── Key material ────────────────────────────────────────────────────────────

/// Current + optional previous PASERK k4.local key, parsed once from env. We
/// verify against current, then previous (zero-downtime rotation). Keys are the
/// raw 32-byte v4.local symmetric keys parsed from the PASERK string Node
/// injected; never re-derived here.
struct Keys {
    current: Option<SymmetricKey<V4>>,
    previous: Option<SymmetricKey<V4>>,
}

static KEYS: LazyLock<Keys> = LazyLock::new(|| {
    let current = std::env::var("NEXUS_STREAM_PASETO_KEY")
        .ok()
        .and_then(|s| parse_paserk(&s));
    if current.is_none() {
        eprintln!(
            "[stream-proxy] NEXUS_STREAM_PASETO_KEY missing or invalid — all grant verification will fail closed"
        );
    }
    let previous = std::env::var("NEXUS_STREAM_PASETO_KEY_PREVIOUS")
        .ok()
        .and_then(|s| parse_paserk(&s));
    Keys { current, previous }
});

fn parse_paserk(s: &str) -> Option<SymmetricKey<V4>> {
    SymmetricKey::<V4>::try_from(s.trim()).ok()
}

// ── Held-cred table ─────────────────────────────────────────────────────────

static HELD_CREDS: LazyLock<HeldCredTable> = LazyLock::new(|| {
    match std::env::var("NEXUS_STREAM_HELD_CREDS") {
        Ok(raw) if !raw.trim().is_empty() => serde_json::from_str(&raw).unwrap_or_else(|e| {
            eprintln!("[stream-proxy] NEXUS_STREAM_HELD_CREDS parse error: {e} — starting with empty table");
            HashMap::new()
        }),
        _ => HashMap::new(),
    }
});

/// Resolve the held cred for a backend. `None` ⇒ fail closed (403).
pub fn held_cred(backend: &str) -> Option<HeldCred> {
    HELD_CREDS.get(backend).cloned()
}

// ── Implicit assertion ──────────────────────────────────────────────────────

/// Reconstruct the implicit-assertion bytes EXACTLY as the Node mint side
/// serialized them (`stream-grant.ts::serializeImplicitAssertion`). PASETO
/// authenticates these raw bytes into the tag — any divergence (key order,
/// spacing, escaping) makes verification fail, so this must mirror Node
/// byte-for-byte: `{"user_id":<json-string>,"hop_index":<n>,"gen":<n>}`.
pub fn implicit_assertion_bytes(user_id: &str, hop_index: u64, generation: u64) -> Vec<u8> {
    // serde_json::to_string on a String yields the same escaping rules Node's
    // JSON.stringify uses for a string, so user_id is escaped identically.
    let uid = serde_json::to_string(user_id).unwrap_or_else(|_| "\"\"".to_string());
    format!("{{\"user_id\":{uid},\"hop_index\":{hop_index},\"gen\":{generation}}}").into_bytes()
}

// ── Verification ────────────────────────────────────────────────────────────

/// Verify a grant token and bind it to the caller-presented `user_id`,
/// defaulting `gen` to 0 (the mint default).
///
/// PASETO v4.local authenticates the implicit assertion into the AEAD tag, so
/// the exact `{user_id, hop_index, gen}` bytes must be known BEFORE decrypting —
/// we can't read claims first. The Nexus seam always knows the user's current
/// `gen`, so the real entry point is [`verify_grant_with_gen`], which takes it
/// explicitly. This convenience wrapper covers the common `gen == 0` case (tests
/// + the back-compat `/session` inline path) without the seam threading gen.
pub fn verify_grant(
    token: &str,
    expected_user_id: &str,
    hop_index: u64,
) -> Result<VerifiedGrant, VerifyError> {
    verify_grant_with_gen(token, expected_user_id, hop_index, 0)
}

/// Verify a grant given the exact `gen` the seam expects for this user. This is
/// the real entry point: the implicit assertion is reconstructed from
/// `(expected_user_id, hop_index, gen)` and authenticated by the tag, so a
/// wrong user, wrong hop, or stale gen all fail as `BadToken`.
pub fn verify_grant_with_gen(
    token: &str,
    expected_user_id: &str,
    hop_index: u64,
    generation: u64,
) -> Result<VerifiedGrant, VerifyError> {
    let implicit = implicit_assertion_bytes(expected_user_id, hop_index, generation);
    let untrusted =
        UntrustedToken::<Local, V4>::try_from(token).map_err(|_| VerifyError::BadToken)?;
    // Try current key, then previous (rotation window).
    let trusted = try_decrypt(&untrusted, &implicit).ok_or(VerifyError::BadToken)?;
    finish_verify(trusted, expected_user_id, hop_index, generation)
}

/// Verify against an EXPLICIT key (the golden-vector test + any caller that
/// doesn't want the env-loaded keys). Same security properties as
/// [`verify_grant_with_gen`]: the implicit assertion is reconstructed from
/// `(expected_user_id, hop_index, generation)` and authenticated by the tag.
pub fn verify_grant_with_key(
    token: &str,
    key: &SymmetricKey<V4>,
    expected_user_id: &str,
    hop_index: u64,
    generation: u64,
) -> Result<VerifiedGrant, VerifyError> {
    let implicit = implicit_assertion_bytes(expected_user_id, hop_index, generation);
    let untrusted =
        UntrustedToken::<Local, V4>::try_from(token).map_err(|_| VerifyError::BadToken)?;
    let trusted =
        LocalToken::decrypt(key, &untrusted, None, Some(&implicit)).map_err(|_| VerifyError::BadToken)?;
    finish_verify(trusted, expected_user_id, hop_index, generation)
}

fn finish_verify(
    trusted: pasetors::token::TrustedToken,
    expected_user_id: &str,
    hop_index: u64,
    generation: u64,
) -> Result<VerifiedGrant, VerifyError> {
    let claims: GrantClaims =
        serde_json::from_str(trusted.payload()).map_err(|_| VerifyError::BadClaims)?;
    // Native exp check (RFC3339 → epoch).
    if is_expired(&claims.exp) {
        return Err(VerifyError::Expired);
    }
    // The tag already proved the token was minted for `expected_user_id` (it's
    // in the implicit assertion). user_id lives only in the assertion, so we
    // echo the expected one — a mismatch would have failed as BadToken above.
    Ok(VerifiedGrant {
        claims: GrantClaims {
            generation,
            ..claims
        },
        user_id: expected_user_id.to_string(),
        hop_index,
        generation,
    })
}

/// Parse a PASERK `k4.local` key string into a usable symmetric key. Exposed for
/// the golden-vector test (which supplies the fixed fixture key directly).
pub fn parse_local_key(paserk: &str) -> Option<SymmetricKey<V4>> {
    parse_paserk(paserk)
}

fn try_decrypt(
    untrusted: &UntrustedToken<Local, V4>,
    implicit: &[u8],
) -> Option<pasetors::token::TrustedToken> {
    // pasetors footer handling: we minted with an optional footer (kid). When a
    // footer is present in the token it's validated structurally; we pass `None`
    // so it's accepted-but-not-compared. The implicit assertion is the security
    // binding.
    if let Some(k) = &KEYS.current {
        if let Ok(t) = LocalToken::decrypt(k, untrusted, None, Some(implicit)) {
            return Some(t);
        }
    }
    if let Some(k) = &KEYS.previous {
        if let Ok(t) = LocalToken::decrypt(k, untrusted, None, Some(implicit)) {
            return Some(t);
        }
    }
    None
}

fn is_expired(exp_rfc3339: &str) -> bool {
    match parse_rfc3339_epoch(exp_rfc3339) {
        Some(exp) => now_epoch() >= exp,
        // Unparseable exp = treat as expired (fail closed).
        None => true,
    }
}

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(u64::MAX)
}

/// Minimal RFC3339 → unix-epoch-seconds parser. Handles the forms paseto-ts and
/// pasetors emit: `YYYY-MM-DDTHH:MM:SS[.fff]Z` and `±HH:MM` offsets. Returns
/// `None` on anything it can't parse (caller treats that as expired).
fn parse_rfc3339_epoch(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: i64 = s.get(5..7)?.parse().ok()?;
    let day: i64 = s.get(8..10)?.parse().ok()?;
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    let min: i64 = s.get(14..16)?.parse().ok()?;
    let sec: i64 = s.get(17..19)?.parse().ok()?;

    // Optional fractional seconds, then a timezone designator.
    let mut idx = 19;
    if b.get(idx) == Some(&b'.') {
        idx += 1;
        while idx < b.len() && b[idx].is_ascii_digit() {
            idx += 1;
        }
    }
    // Timezone offset (we honor it so non-UTC exp strings still compare right).
    let mut offset_secs: i64 = 0;
    match b.get(idx) {
        Some(&b'Z') | Some(&b'z') | None => {}
        Some(&b'+') | Some(&b'-') => {
            let sign = if b[idx] == b'-' { -1 } else { 1 };
            let oh: i64 = s.get(idx + 1..idx + 3)?.parse().ok()?;
            let om: i64 = s.get(idx + 4..idx + 6)?.parse().ok()?;
            offset_secs = sign * (oh * 3600 + om * 60);
        }
        _ => return None,
    }

    let days = days_from_civil(year, month, day);
    let epoch = days * 86400 + hour * 3600 + min * 60 + sec - offset_secs;
    if epoch < 0 {
        None
    } else {
        Some(epoch as u64)
    }
}

/// Days since the Unix epoch for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_parses_utc_z() {
        // 2020-01-01T00:00:00Z = 1577836800
        assert_eq!(parse_rfc3339_epoch("2020-01-01T00:00:00Z"), Some(1577836800));
    }

    #[test]
    fn rfc3339_parses_millis_z() {
        assert_eq!(
            parse_rfc3339_epoch("2020-01-01T00:00:00.000Z"),
            Some(1577836800)
        );
    }

    #[test]
    fn rfc3339_honors_offset() {
        // 2020-01-01T01:00:00+01:00 == 2020-01-01T00:00:00Z
        assert_eq!(
            parse_rfc3339_epoch("2020-01-01T01:00:00+01:00"),
            Some(1577836800)
        );
    }

    #[test]
    fn rfc3339_rejects_garbage() {
        assert_eq!(parse_rfc3339_epoch("not-a-date"), None);
        assert_eq!(parse_rfc3339_epoch(""), None);
    }

    #[test]
    fn implicit_assertion_matches_node_serialization() {
        // Must mirror stream-grant.ts::serializeImplicitAssertion exactly.
        let bytes = implicit_assertion_bytes("user-001", 0, 7);
        assert_eq!(
            std::str::from_utf8(&bytes).unwrap(),
            r#"{"user_id":"user-001","hop_index":0,"gen":7}"#
        );
    }

    #[test]
    fn implicit_assertion_escapes_user_id() {
        let bytes = implicit_assertion_bytes("a\"b", 1, 2);
        assert_eq!(
            std::str::from_utf8(&bytes).unwrap(),
            r#"{"user_id":"a\"b","hop_index":1,"gen":2}"#
        );
    }

    #[test]
    fn expired_when_exp_in_past() {
        assert!(is_expired("2000-01-01T00:00:00Z"));
    }

    #[test]
    fn not_expired_when_exp_far_future() {
        assert!(!is_expired("2099-01-01T00:00:00Z"));
    }
}
