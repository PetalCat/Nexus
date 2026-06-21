//! Cross-language golden-vector test (the critical correctness proof).
//!
//! The fixture `tests/fixtures/golden-vector.json` is minted by the Node side
//! (`scripts/mint-golden-vector.mjs`, using `paseto-ts`) with a FIXED k4.local
//! key. This test loads that fixture and proves the Rust `pasetors` verifier is
//! byte-compatible:
//!
//!   - Node-mint → Rust-verify PASS: the valid token verifies and every grant
//!     field (backend, resource_ref, allowed_hops, exp, gen) + the implicit
//!     assertion (user_id, hop_index, gen) reconstruct exactly.
//!   - Tamper REJECT: a byte-flipped token fails (AEAD tag).
//!   - Expired REJECT: a past-exp token is rejected by the native exp check.
//!   - Wrong-user REJECT: verifying with a different user_id rebuilds a
//!     different implicit assertion → tag mismatch → reject.
//!
//! Regenerate the fixture after any mint/serialize change:
//!     node scripts/mint-golden-vector.mjs

use nexus_stream_proxy::session::{self, VerifyError};
use serde::Deserialize;

#[derive(Deserialize)]
struct ExpectedClaims {
    backend: String,
    resource_ref: String,
    allowed_hops: String,
    #[serde(rename = "gen")]
    generation: u64,
    exp: String,
}

#[derive(Deserialize)]
struct Fixture {
    paserk_local_key: String,
    expected_user_id: String,
    expected_hop_index: u64,
    expected_gen: u64,
    expected_implicit_assertion: String,
    expected_claims: ExpectedClaims,
    valid_token: String,
    expired_token: String,
    tampered_token: String,
    wrong_user_id: String,
}

fn load_fixture() -> Fixture {
    let raw = include_str!("fixtures/golden-vector.json");
    serde_json::from_str(raw).expect("fixture parses")
}

#[test]
fn node_mint_rust_verify_reconstructs_grant() {
    let f = load_fixture();
    let key = session::parse_local_key(&f.paserk_local_key).expect("PASERK key parses");

    // First, prove the implicit-assertion serialization matches Node byte-for-byte.
    let rust_ia = session::implicit_assertion_bytes(&f.expected_user_id, f.expected_hop_index, f.expected_gen);
    assert_eq!(
        std::str::from_utf8(&rust_ia).unwrap(),
        f.expected_implicit_assertion,
        "Rust implicit-assertion bytes must match Node's exactly"
    );

    let grant = session::verify_grant_with_key(
        &f.valid_token,
        &key,
        &f.expected_user_id,
        f.expected_hop_index,
        f.expected_gen,
    )
    .expect("Node-minted token must verify on the Rust side");

    // Reconstructed grant fields must match the fixture exactly.
    assert_eq!(grant.claims.backend, f.expected_claims.backend);
    assert_eq!(grant.claims.resource_ref, f.expected_claims.resource_ref);
    assert_eq!(grant.claims.allowed_hops, f.expected_claims.allowed_hops);
    assert_eq!(grant.claims.exp, f.expected_claims.exp);
    assert_eq!(grant.claims.generation, f.expected_claims.generation);
    assert_eq!(grant.user_id, f.expected_user_id);
    assert_eq!(grant.hop_index, f.expected_hop_index);
    assert_eq!(grant.generation, f.expected_gen);

    println!("GOLDEN-VECTOR PASS: Node-mint → Rust-verify reconstructed grant {{ backend: {}, resource_ref: {}, user_id: {}, gen: {} }}",
        grant.claims.backend, grant.claims.resource_ref, grant.user_id, grant.generation);
}

#[test]
fn tampered_token_rejected() {
    let f = load_fixture();
    let key = session::parse_local_key(&f.paserk_local_key).unwrap();
    let res = session::verify_grant_with_key(
        &f.tampered_token,
        &key,
        &f.expected_user_id,
        f.expected_hop_index,
        f.expected_gen,
    );
    assert!(res.is_err(), "tampered token must be rejected");
    assert_eq!(res.unwrap_err(), VerifyError::BadToken);
    println!("GOLDEN-VECTOR REJECT (tamper): byte-flip → BadToken");
}

#[test]
fn expired_token_rejected() {
    let f = load_fixture();
    let key = session::parse_local_key(&f.paserk_local_key).unwrap();
    let res = session::verify_grant_with_key(
        &f.expired_token,
        &key,
        &f.expected_user_id,
        f.expected_hop_index,
        f.expected_gen,
    );
    assert!(res.is_err(), "expired token must be rejected");
    assert_eq!(res.unwrap_err(), VerifyError::Expired);
    println!("GOLDEN-VECTOR REJECT (expired): past exp → Expired");
}

#[test]
fn wrong_user_rejected() {
    let f = load_fixture();
    let key = session::parse_local_key(&f.paserk_local_key).unwrap();
    // Same valid token, but verify as a DIFFERENT user → the reconstructed
    // implicit assertion differs → the AEAD tag won't match → reject.
    let res = session::verify_grant_with_key(
        &f.valid_token,
        &key,
        &f.wrong_user_id,
        f.expected_hop_index,
        f.expected_gen,
    );
    assert!(res.is_err(), "wrong-user verification must be rejected");
    assert_eq!(res.unwrap_err(), VerifyError::BadToken);
    println!("GOLDEN-VECTOR REJECT (wrong-user): user '{}' replaying user '{}' token → BadToken (copy-paste defense)", f.wrong_user_id, f.expected_user_id);
}

#[test]
fn wrong_gen_rejected() {
    // A stale gen (logout/disable epoch bump) changes the implicit assertion →
    // tag mismatch → reject. Proves gen revocation binds via the assertion.
    let f = load_fixture();
    let key = session::parse_local_key(&f.paserk_local_key).unwrap();
    let res = session::verify_grant_with_key(
        &f.valid_token,
        &key,
        &f.expected_user_id,
        f.expected_hop_index,
        f.expected_gen + 1,
    );
    assert!(res.is_err(), "stale gen must be rejected");
    assert_eq!(res.unwrap_err(), VerifyError::BadToken);
    println!("GOLDEN-VECTOR REJECT (stale gen): gen+1 → BadToken");
}
