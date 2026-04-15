use dashmap::DashMap;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

type HmacSha256 = Hmac<Sha256>;

/// Process-lifetime HMAC secret. Regenerated on every start — sessions don't
/// need to survive restarts because the Node supervisor restarts us anyway.
static SECRET: LazyLock<[u8; 32]> = LazyLock::new(|| {
    let mut buf = [0u8; 32];
    use rand::RngCore;
    rand::thread_rng().fill_bytes(&mut buf);
    buf
});

/// Sessions are keyed by 16-char hex ID, store the upstream URL + auth headers.
static SESSIONS: LazyLock<DashMap<String, Session>> = LazyLock::new(DashMap::new);

const SESSION_TTL: Duration = Duration::from_secs(6 * 60 * 60); // 6h

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub upstream_url: String,
    pub auth_headers: HashMap<String, String>,
    /// If true, HLS manifests are parsed and rewritten as they pass through.
    #[serde(default)]
    pub is_hls: bool,
    /// Monotonic creation timestamp. Not serialized — set to `Instant::now()` when
    /// the struct is deserialized from the POST body. Used only for TTL enforcement.
    #[serde(skip, default = "Instant::now")]
    pub created_at: Instant,
}

pub fn create(session: Session) -> String {
    // 16 random hex chars = 64 bits of entropy, plenty for process-lifetime IDs.
    let mut id_bytes = [0u8; 8];
    use rand::RngCore;
    rand::thread_rng().fill_bytes(&mut id_bytes);
    let id = hex::encode(id_bytes);
    SESSIONS.insert(id.clone(), session);
    id
}

pub fn sign(id: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(&*SECRET).expect("valid HMAC key");
    mac.update(id.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

pub fn verify(id: &str, signature: &str) -> bool {
    let expected = sign(id);
    // Constant-time comparison — subtle::ConstantTimeEq would be better but
    // `hex::encode` already returns a `String` so we get timing behavior that
    // depends on the length check. Acceptable for 64-char hex digests.
    expected.len() == signature.len()
        && expected
            .bytes()
            .zip(signature.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

pub fn get(id: &str) -> Option<Session> {
    let entry = SESSIONS.get(id)?;
    if entry.created_at.elapsed() > SESSION_TTL {
        drop(entry);
        SESSIONS.remove(id);
        return None;
    }
    Some(entry.clone())
}

pub fn remove(id: &str) {
    SESSIONS.remove(id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_session() -> Session {
        Session {
            upstream_url: "http://example.com/master.m3u8".to_string(),
            auth_headers: HashMap::from([("X-Api-Key".to_string(), "secret".to_string())]),
            is_hls: true,
            created_at: Instant::now(),
        }
    }

    #[test]
    fn create_returns_unique_hex_ids() {
        let a = create(fresh_session());
        let b = create(fresh_session());
        assert_ne!(a, b, "IDs must be unique");
        assert_eq!(a.len(), 16, "ID is 16 hex chars");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn sign_and_verify_round_trip() {
        let id = create(fresh_session());
        let sig = sign(&id);
        assert!(verify(&id, &sig), "valid signature verifies");
        assert!(!verify(&id, "bogus"), "bogus signature rejected");
        assert!(
            !verify(&id, &sig.replace('a', "b")),
            "tampered signature rejected"
        );
    }

    #[test]
    fn get_returns_stored_session() {
        let id = create(fresh_session());
        let s = get(&id).expect("session present");
        assert_eq!(s.upstream_url, "http://example.com/master.m3u8");
        assert_eq!(s.auth_headers.get("X-Api-Key"), Some(&"secret".to_string()));
    }

    #[test]
    fn get_returns_none_for_unknown_id() {
        assert!(get("deadbeef00000000").is_none());
    }

    #[test]
    fn remove_evicts_session() {
        let id = create(fresh_session());
        remove(&id);
        assert!(get(&id).is_none());
    }
}
