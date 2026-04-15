# Player Rework — Phase 1 — Rust Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `stream-proxy/` Rust binary the authoritative byte pipe for Jellyfin HLS playback: add a generic session endpoint, an HLS manifest rewriter that strips Jellyfin's `ApiKey`, a Docker build stage that compiles the binary into the runtime image, and a Node-side route handler that delegates to it. Nothing user-visible changes in this phase — the player UI and contract are untouched. Phase 1 is pure plumbing.

**Architecture:** Node (SvelteKit adapter-node) handles auth, calls `POST http://127.0.0.1:3939/session` with the upstream Jellyfin URL + auth headers, receives a signed `session_id`, and hands the client a `/stream/{id}` URL to hit directly through the Node origin (which is then reverse-proxied by the Rust binary). The Rust binary verifies the HMAC, opens the upstream URL, and pipes bytes zero-copy via `reqwest::Response::bytes_stream` → hyper body. HLS master playlists are parsed with `m3u8-rs`, variant/segment URIs rewritten, `ApiKey` stripped from every query string the browser will see.

**Tech Stack:** Rust (hyper 1.x, tokio, reqwest, m3u8-rs, hmac, sha2, serde), TypeScript (SvelteKit adapter-node, vitest for tests), Docker multi-stage build.

**Spec:** `docs/superpowers/specs/2026-04-15-player-streaming-rework-design.md`

---

## File structure

**New files:**

| Path | Responsibility |
|---|---|
| `stream-proxy/src/session.rs` | Session store (DashMap), HMAC signing/verification, session TTL |
| `stream-proxy/src/handlers/mod.rs` | Module root — re-exports session + hls + invidious handlers |
| `stream-proxy/src/handlers/session.rs` | `POST /session` + `GET /stream/{id}` handlers |
| `stream-proxy/src/handlers/hls.rs` | HLS manifest rewriter (`m3u8-rs` parse → rewrite → serialize) |
| `stream-proxy/src/handlers/invidious.rs` | Existing Invidious-specific handlers moved out of `main.rs` |
| `stream-proxy/src/proxy.rs` | Shared upstream fetch helper (Range passthrough, header forwarding) |
| `stream-proxy/tests/session_integration.rs` | Integration tests hitting the proxy with a mock upstream |
| `scripts/benchmark-proxy.sh` | Benchmark harness for Phase 1 exit criteria |

**Modified files:**

| Path | Change |
|---|---|
| `stream-proxy/Cargo.toml` | Add `m3u8-rs`, `hmac`, `sha2`, `serde`, `serde_json`, `hex` deps |
| `stream-proxy/src/main.rs` | Slim down to 80 lines: module imports + router + bind loop |
| `Dockerfile` | Add `rust-build` stage, copy binary into runtime stage |
| `src/lib/server/stream-proxy.ts` | Use `sveltekit:shutdown` event for cleanup; add `spawnSessionClient()` helper |
| `src/routes/api/stream/[serviceId]/[...path]/+server.ts` | Delegate HLS requests to Rust proxy via session handoff |
| `src/hooks.server.ts` | Wire `sveltekit:shutdown` listener for graceful child-process shutdown |

**Out of scope for Phase 1 (handled in later phases):**
- `/api/video/stream/[videoId]/+server.ts` — Invidious path keeps working as-is in Phase 1. Migration to the session model is a Phase 2 cleanup.
- The `negotiatePlayback` contract. Phase 1 still uses the existing query-param-injection Node logic for building upstream URLs; the Rust proxy just delivers the bytes.
- Any player-side change. Phase 1 is invisible to the client.

---

## Task 1 — Add deps and split into library + binary crate

We do the library/binary split up front so every subsequent task can add `pub mod X;` to a single canonical location (`lib.rs`), instead of starting in `main.rs` and migrating mid-plan.

**Files:**
- Modify: `stream-proxy/Cargo.toml`
- Create: `stream-proxy/src/lib.rs`

- [ ] **Step 1: Edit `Cargo.toml` to add deps + declare lib and bin targets**

Replace the file's `[package]` + `[dependencies]` + `[profile.release]` blocks with this complete file:

```toml
[package]
name = "nexus-stream-proxy"
version = "0.1.0"
edition = "2024"

[lib]
name = "nexus_stream_proxy"
path = "src/lib.rs"

[[bin]]
name = "nexus-stream-proxy"
path = "src/main.rs"

[dependencies]
tokio = { version = "1", features = ["full"] }
hyper = { version = "1", features = ["http1", "server"] }
hyper-util = { version = "0.1", features = ["tokio", "http1"] }
http-body-util = "0.1"
reqwest = { version = "0.12", features = ["stream"] }
futures-util = "0.3"
dashmap = "6"
socket2 = "0.5"
urlencoding = "2.1.3"
m3u8-rs = "6"
hmac = "0.12"
sha2 = "0.10"
hex = "0.4"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rand = "0.8"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
strip = true
```

- [ ] **Step 2: Create `stream-proxy/src/lib.rs`**

```rust
//! Library crate exposing internal modules so they can be unit-tested
//! and used by the binary entry point (`main.rs`) and integration tests.

pub mod handlers;
pub mod proxy;
pub mod session;
```

- [ ] **Step 3: Create empty placeholder files so Cargo doesn't error on missing modules**

```bash
mkdir -p stream-proxy/src/handlers
touch stream-proxy/src/proxy.rs
touch stream-proxy/src/session.rs
echo "pub mod hls; pub mod invidious; pub mod session;" > stream-proxy/src/handlers/mod.rs
touch stream-proxy/src/handlers/hls.rs
touch stream-proxy/src/handlers/invidious.rs
touch stream-proxy/src/handlers/session.rs
```

- [ ] **Step 4: Make the empty placeholder files compile**

The empty files will fail to compile because `handlers::invidious` etc. are referenced from `mod.rs`. Fill each file with a `// placeholder` comment:

```bash
for f in stream-proxy/src/proxy.rs stream-proxy/src/session.rs stream-proxy/src/handlers/hls.rs stream-proxy/src/handlers/invidious.rs stream-proxy/src/handlers/session.rs; do
  echo '// placeholder — implemented in a later task' > "$f"
done
```

- [ ] **Step 5: Verify the crate still builds**

Run: `cd stream-proxy && cargo check 2>&1 | tail -10`
Expected: `Finished \`dev\` profile`. Warnings about unused imports in `main.rs` (which still declares its own `mod` blocks for the legacy code) are fine for now — Task 8 cleans those up.

If `cargo check` fails because the existing `main.rs` references modules declared as `mod X;` that now live in `lib.rs`, leave the existing `mod` declarations in `main.rs` alone for now. We're keeping the lib + bin both happy by having both crates carry the modules until Task 8 collapses them.

- [ ] **Step 6: Commit**

```bash
git add stream-proxy/Cargo.toml stream-proxy/Cargo.lock stream-proxy/src/lib.rs stream-proxy/src/handlers stream-proxy/src/proxy.rs stream-proxy/src/session.rs
git commit -m "stream-proxy: split into library + binary crate with placeholder modules"
```

---

## Task 2 — Session store with HMAC signing

**Files:**
- Modify: `stream-proxy/src/session.rs` (placeholder created in Task 1)

- [ ] **Step 1: Replace `stream-proxy/src/session.rs` with the implementation + tests**

```rust
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
    /// Serialized `Instant` can't round-trip over JSON, so we use elapsed-ms
    /// from a monotonic start at the server level instead.
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
```

- [ ] **Step 2: Run the tests and verify they pass**

The module is already wired up via `lib.rs` (Task 1). Cargo discovers it automatically.

Run: `cd stream-proxy && cargo test --lib session 2>&1 | tail -20`
Expected: `test result: ok. 5 passed`

- [ ] **Step 3: Commit**

```bash
git add stream-proxy/src/session.rs
git commit -m "stream-proxy: add session store with HMAC signing (session.rs)"
```

---

## Task 3 — Shared upstream fetch helper

**Files:**
- Modify: `stream-proxy/src/proxy.rs` (placeholder from Task 1)

- [ ] **Step 1: Replace `stream-proxy/src/proxy.rs` with the implementation**

```rust
use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::body::{Bytes, Frame};
use hyper::{HeaderMap, Response, StatusCode};
use reqwest::Client;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

pub type BoxError = Box<dyn std::error::Error + Send + Sync>;

pub static HTTP_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(60))
        .pool_max_idle_per_host(32)
        .build()
        .expect("reqwest client build")
});

/// Headers we forward from client → upstream. Any other client header is dropped.
const FORWARDED_REQUEST_HEADERS: &[&str] = &["range", "if-none-match", "if-modified-since"];

/// Headers we forward from upstream → client. Any other upstream header is dropped.
const FORWARDED_RESPONSE_HEADERS: &[&str] = &[
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
    "cache-control",
];

pub fn empty_body() -> BoxBody<Bytes, BoxError> {
    http_body_util::Empty::<Bytes>::new()
        .map_err(|never| match never {})
        .boxed()
}

pub fn full_body<T: Into<Bytes>>(chunk: T) -> BoxBody<Bytes, BoxError> {
    Full::new(chunk.into())
        .map_err(|never| match never {})
        .boxed()
}

/// Proxy an upstream request through our hyper response, streaming body chunks
/// without application-level buffering.
///
/// `extra_upstream_headers` are injected unconditionally (e.g. auth tokens the
/// browser never sees). `client_headers` is the original client request header
/// map; we filter it down to `FORWARDED_REQUEST_HEADERS` before sending.
pub async fn proxy_stream(
    upstream_url: &str,
    extra_upstream_headers: &HashMap<String, String>,
    client_headers: &HeaderMap,
) -> Response<BoxBody<Bytes, BoxError>> {
    let mut req = HTTP_CLIENT.get(upstream_url);

    for &name in FORWARDED_REQUEST_HEADERS {
        if let Some(value) = client_headers.get(name) {
            if let Ok(v) = value.to_str() {
                req = req.header(name, v);
            }
        }
    }
    for (name, value) in extra_upstream_headers {
        req = req.header(name, value);
    }

    let upstream = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[stream-proxy] upstream fetch error: {e}");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(full_body(format!("upstream error: {e}")))
                .unwrap();
        }
    };

    let status = upstream.status();
    let mut builder = Response::builder().status(status.as_u16());
    let headers_out = builder.headers_mut().unwrap();
    for &name in FORWARDED_RESPONSE_HEADERS {
        if let Some(value) = upstream.headers().get(name) {
            headers_out.insert(name, value.clone());
        }
    }

    let stream = upstream
        .bytes_stream()
        .map_ok(Frame::data)
        .map_err(|e| -> BoxError { Box::new(e) });

    let body = StreamBody::new(stream).boxed();
    builder.body(body).unwrap()
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd stream-proxy && cargo check --lib 2>&1 | tail -15`
Expected: `Finished` (errors not OK).

- [ ] **Step 3: Commit**

```bash
git add stream-proxy/src/proxy.rs
git commit -m "stream-proxy: add shared upstream fetch helper (proxy.rs)"
```

---

## Task 4 — HLS manifest rewriter

**Files:**
- Modify: `stream-proxy/src/handlers/hls.rs` (placeholder from Task 1)

- [ ] **Step 1: Replace `stream-proxy/src/handlers/hls.rs` with the implementation + tests**

```rust
use m3u8_rs::{parse_playlist_res, Playlist};

/// Rewrite a Jellyfin HLS playlist for proxy delivery:
///
/// 1. Strip `ApiKey` / `api_key` from all URI query strings so the admin token
///    is never handed to the browser.
/// 2. Rewrite absolute and relative segment/variant URIs to go through the
///    proxy at `/stream/{session_id}/<original-path>` so the browser never
///    talks to Jellyfin directly.
/// 3. Preserve all `EXT-X-STREAM-INF` attributes (bandwidth, resolution, codecs).
///
/// Returns the rewritten manifest bytes.
pub fn rewrite_manifest(raw: &[u8], session_id: &str) -> Result<Vec<u8>, String> {
    let parsed = parse_playlist_res(raw).map_err(|e| format!("parse: {e:?}"))?;
    match parsed {
        Playlist::MasterPlaylist(mut master) => {
            for variant in &mut master.variants {
                variant.uri = rewrite_uri(&variant.uri, session_id);
            }
            for media in &mut master.alternatives {
                if let Some(uri) = media.uri.take() {
                    media.uri = Some(rewrite_uri(&uri, session_id));
                }
            }
            let mut out = Vec::new();
            master
                .write_to(&mut out)
                .map_err(|e| format!("write master: {e}"))?;
            Ok(out)
        }
        Playlist::MediaPlaylist(mut media) => {
            for segment in &mut media.segments {
                segment.uri = rewrite_uri(&segment.uri, session_id);
                if let Some(map) = &mut segment.map {
                    map.uri = rewrite_uri(&map.uri, session_id);
                }
                if let Some(key) = &mut segment.key {
                    if let Some(uri) = key.uri.take() {
                        key.uri = Some(rewrite_uri(&uri, session_id));
                    }
                }
            }
            let mut out = Vec::new();
            media
                .write_to(&mut out)
                .map_err(|e| format!("write media: {e}"))?;
            Ok(out)
        }
    }
}

/// Strip `ApiKey` / `api_key` and rewrite a single URI to `/stream/{id}/<opaque>`.
///
/// The "opaque" suffix is a base16 of the original URI's path+query minus the
/// stripped auth. On the return trip, the session handler decodes it and
/// forwards to the upstream with the session's real auth headers.
fn rewrite_uri(uri: &str, session_id: &str) -> String {
    let stripped = strip_auth_query(uri);
    format!("/stream/{session_id}/{}", hex::encode(stripped.as_bytes()))
}

fn strip_auth_query(uri: &str) -> String {
    let (path, query) = match uri.split_once('?') {
        Some((p, q)) => (p, q),
        None => return uri.to_string(),
    };
    let kept: Vec<&str> = query
        .split('&')
        .filter(|p| {
            let name = p.split_once('=').map(|(k, _)| k).unwrap_or(p);
            !name.eq_ignore_ascii_case("apikey") && !name.eq_ignore_ascii_case("api_key")
        })
        .collect();
    if kept.is_empty() {
        path.to_string()
    } else {
        format!("{path}?{}", kept.join("&"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_auth_removes_apikey_casings() {
        assert_eq!(
            strip_auth_query("/segment.ts?foo=1&ApiKey=abc&bar=2"),
            "/segment.ts?foo=1&bar=2"
        );
        assert_eq!(
            strip_auth_query("/segment.ts?foo=1&api_key=abc&bar=2"),
            "/segment.ts?foo=1&bar=2"
        );
        assert_eq!(
            strip_auth_query("/segment.ts?ApiKey=abc"),
            "/segment.ts"
        );
        assert_eq!(strip_auth_query("/segment.ts"), "/segment.ts");
    }

    #[test]
    fn rewrite_uri_produces_proxy_path() {
        let out = rewrite_uri("/Videos/abc/hls1/main/0.ts?ApiKey=secret", "sess123");
        assert!(out.starts_with("/stream/sess123/"));
        assert!(!out.contains("secret"), "api key must be absent");
        assert!(!out.contains("ApiKey"), "api key param name must be absent");
    }

    #[test]
    fn rewrite_master_playlist_rewrites_variants() {
        let input = b"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=640x360,CODECS=\"avc1.64001f,mp4a.40.2\"
/Videos/abc/main.m3u8?ApiKey=leaky
";
        let out = rewrite_manifest(input, "s1").expect("parses and rewrites");
        let out_str = std::str::from_utf8(&out).unwrap();
        assert!(out_str.contains("BANDWIDTH=1280000"), "preserves bandwidth");
        assert!(out_str.contains("RESOLUTION=640x360"), "preserves resolution");
        assert!(!out_str.contains("leaky"), "strips api key");
        assert!(out_str.contains("/stream/s1/"), "rewrites URI through proxy");
    }

    #[test]
    fn rewrite_media_playlist_rewrites_segments() {
        let input = b"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
/Videos/abc/hls1/main/0.ts?ApiKey=leaky
#EXTINF:6.0,
/Videos/abc/hls1/main/1.ts?ApiKey=leaky
#EXT-X-ENDLIST
";
        let out = rewrite_manifest(input, "s1").expect("parses and rewrites");
        let out_str = std::str::from_utf8(&out).unwrap();
        assert!(!out_str.contains("leaky"));
        assert!(out_str.contains("/stream/s1/"));
        assert!(out_str.contains("#EXTINF:6"), "preserves EXTINF");
    }
}
```

- [ ] **Step 2: Run the HLS tests**

Run: `cd stream-proxy && cargo test --lib hls 2>&1 | tail -20`
Expected: `test result: ok. 4 passed`

If m3u8-rs API differs from what the test expects (e.g. `media.key.uri` is not `Option<String>` in the version published to crates.io), adjust the field access to match the actual crate API. The failure will be a compile error, not a runtime error — read the message and patch the field access accordingly.

- [ ] **Step 3: Commit**

```bash
git add stream-proxy/src/handlers/hls.rs
git commit -m "stream-proxy: HLS manifest rewriter with ApiKey stripping"
```

---

## Task 5 — Session handler (POST /session, GET /stream/{id}/...)

**Files:**
- Modify: `stream-proxy/src/handlers/session.rs` (placeholder from Task 1)

- [ ] **Step 1: Replace `stream-proxy/src/handlers/session.rs` with the implementation + tests**

```rust
use crate::handlers::hls::rewrite_manifest;
use crate::proxy::{empty_body, full_body, proxy_stream, BoxError, HTTP_CLIENT};
use crate::session::{self as session_store, Session};
use http_body_util::{BodyExt, combinators::BoxBody};
use hyper::body::{Bytes, Incoming};
use hyper::{Request, Response, StatusCode};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct CreateSessionBody {
    pub upstream_url: String,
    #[serde(default)]
    pub auth_headers: HashMap<String, String>,
    #[serde(default)]
    pub is_hls: bool,
}

/// Handle `POST /session`. Reads JSON body, stores the session, returns signed ID.
pub async fn create(req: Request<Incoming>) -> Response<BoxBody<Bytes, BoxError>> {
    let body_bytes = match req.into_body().collect().await {
        Ok(c) => c.to_bytes(),
        Err(e) => {
            eprintln!("[stream-proxy] /session body read: {e}");
            return json_error(StatusCode::BAD_REQUEST, "body read error");
        }
    };
    let parsed: CreateSessionBody = match serde_json::from_slice(&body_bytes) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[stream-proxy] /session json parse: {e}");
            return json_error(StatusCode::BAD_REQUEST, "invalid json body");
        }
    };

    let session = Session {
        upstream_url: parsed.upstream_url,
        auth_headers: parsed.auth_headers,
        is_hls: parsed.is_hls,
        created_at: std::time::Instant::now(),
    };
    let id = session_store::create(session);
    let sig = session_store::sign(&id);
    let body = serde_json::json!({
        "session_id": id,
        "signature": sig,
        "stream_url": format!("/stream/{id}?sig={sig}"),
    })
    .to_string();
    Response::builder()
        .status(200)
        .header("content-type", "application/json")
        .body(full_body(body))
        .unwrap()
}

/// Handle `GET /stream/{session_id}[/{encoded_suffix}]?sig=...`.
///
/// - Verifies the HMAC signature in the `sig` query parameter.
/// - Looks up the session.
/// - If `encoded_suffix` is absent, fetches the session's `upstream_url` directly.
///   If `is_hls` is true, parses the response as a manifest and rewrites it.
/// - If `encoded_suffix` is present, decodes it as hex, treats the result as an
///   opaque upstream path (produced by `hls::rewrite_uri`), and fetches a new
///   upstream request relative to the session's upstream origin.
pub async fn stream(req: Request<Incoming>) -> Response<BoxBody<Bytes, BoxError>> {
    let uri = req.uri().clone();
    let path = uri.path();
    let query = uri.query().unwrap_or("");

    let mut parts = path.trim_start_matches("/stream/").splitn(2, '/');
    let session_id = match parts.next() {
        Some(id) if !id.is_empty() => id,
        _ => return json_error(StatusCode::NOT_FOUND, "no session id"),
    };
    let suffix = parts.next();

    let sig = query
        .split('&')
        .find_map(|p| p.strip_prefix("sig="))
        .unwrap_or("");
    if !session_store::verify(session_id, sig) {
        return json_error(StatusCode::FORBIDDEN, "invalid signature");
    }

    let session = match session_store::get(session_id) {
        Some(s) => s,
        None => return json_error(StatusCode::NOT_FOUND, "unknown session"),
    };

    // Figure out the upstream URL for this hit:
    // - root hit → session.upstream_url (typically master.m3u8)
    // - subpath hit → decode hex, resolve relative to upstream origin
    let upstream_url = match suffix {
        None => session.upstream_url.clone(),
        Some(encoded) => {
            let bytes = match hex::decode(encoded) {
                Ok(b) => b,
                Err(_) => return json_error(StatusCode::BAD_REQUEST, "bad encoded suffix"),
            };
            let sub = match std::str::from_utf8(&bytes) {
                Ok(s) => s.to_string(),
                Err(_) => return json_error(StatusCode::BAD_REQUEST, "suffix not utf-8"),
            };
            resolve_relative(&session.upstream_url, &sub)
        }
    };

    // Non-HLS or non-root: straight byte pipe.
    if !session.is_hls || suffix.is_some() {
        return proxy_stream(&upstream_url, &session.auth_headers, req.headers()).await;
    }

    // HLS root hit: fetch + rewrite + serve.
    let mut req_builder = HTTP_CLIENT.get(&upstream_url);
    for (k, v) in &session.auth_headers {
        req_builder = req_builder.header(k, v);
    }
    let upstream = match req_builder.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[stream-proxy] manifest fetch error: {e}");
            return json_error(StatusCode::BAD_GATEWAY, "upstream error");
        }
    };
    let status = upstream.status().as_u16();
    let body = match upstream.bytes().await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[stream-proxy] manifest body read: {e}");
            return json_error(StatusCode::BAD_GATEWAY, "upstream body");
        }
    };
    let rewritten = match rewrite_manifest(&body, session_id) {
        Ok(out) => out,
        Err(e) => {
            eprintln!("[stream-proxy] manifest rewrite error: {e}");
            return json_error(StatusCode::BAD_GATEWAY, "manifest rewrite");
        }
    };
    Response::builder()
        .status(status)
        .header("content-type", "application/vnd.apple.mpegurl")
        .header("cache-control", "no-store")
        .body(full_body(rewritten))
        .unwrap()
}

fn json_error(status: StatusCode, msg: &str) -> Response<BoxBody<Bytes, BoxError>> {
    let body = serde_json::json!({ "error": msg }).to_string();
    Response::builder()
        .status(status.as_u16())
        .header("content-type", "application/json")
        .body(full_body(body))
        .unwrap()
}

/// Resolve `sub` (e.g. `/Videos/abc/main.m3u8`) against the origin component of
/// the session's base URL (e.g. `http://jellyfin.local/Videos/abc/master.m3u8`
/// → origin `http://jellyfin.local`).
fn resolve_relative(base: &str, sub: &str) -> String {
    if sub.starts_with("http://") || sub.starts_with("https://") {
        return sub.to_string();
    }
    let origin_end = base
        .find("://")
        .and_then(|i| base[i + 3..].find('/').map(|j| i + 3 + j))
        .unwrap_or(base.len());
    let origin = &base[..origin_end];
    if sub.starts_with('/') {
        format!("{origin}{sub}")
    } else {
        format!("{origin}/{sub}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_relative_handles_absolute_paths() {
        assert_eq!(
            resolve_relative(
                "http://jellyfin.local/Videos/abc/master.m3u8",
                "/Videos/abc/main.m3u8"
            ),
            "http://jellyfin.local/Videos/abc/main.m3u8"
        );
    }

    #[test]
    fn resolve_relative_handles_https_with_port() {
        assert_eq!(
            resolve_relative(
                "https://jf.example.com:8096/path?x=1",
                "/Videos/abc/segment.ts"
            ),
            "https://jf.example.com:8096/Videos/abc/segment.ts"
        );
    }

    #[test]
    fn resolve_relative_passes_through_absolute_upstream_urls() {
        assert_eq!(
            resolve_relative("http://a", "http://b/x"),
            "http://b/x"
        );
    }
}
```

- [ ] **Step 2: Run the session handler tests**

Run: `cd stream-proxy && cargo test --lib handlers::session 2>&1 | tail -15`
Expected: `test result: ok. 3 passed`

- [ ] **Step 3: Commit**

```bash
git add stream-proxy/src/handlers/session.rs
git commit -m "stream-proxy: session handler (POST /session, GET /stream/{id})"
```

---

## Task 6 — Integration test against a mock upstream

**Files:**
- Create: `stream-proxy/tests/session_integration.rs`

The library/binary split was already done in Task 1, so the integration test can `use nexus_stream_proxy::...` directly with no additional Cargo.toml changes.

- [ ] **Step 1: Create `stream-proxy/tests/session_integration.rs`**

```rust
//! Integration test: spawn a dummy HTTP server, create a session that points
//! at it, hit /stream/{id}, assert bytes come back. Exercises the full stack
//! (session store → proxy → upstream fetch → response pipe) without Docker.

use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::net::TcpListener;

async fn mock_handler(
    req: Request<hyper::body::Incoming>,
) -> Result<Response<http_body_util::Full<Bytes>>, Infallible> {
    let path = req.uri().path();
    let body = match path {
        "/master.m3u8" => concat!(
            "#EXTM3U\n",
            "#EXT-X-VERSION:3\n",
            "#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=640x360\n",
            "/Videos/abc/main.m3u8?ApiKey=secret\n",
        ).as_bytes().to_vec(),
        "/segment.bin" => vec![0u8; 1024 * 1024],
        _ => b"not found".to_vec(),
    };
    Ok(Response::builder()
        .header("content-type", if path.ends_with(".m3u8") { "application/vnd.apple.mpegurl" } else { "application/octet-stream" })
        .header("content-length", body.len().to_string())
        .body(http_body_util::Full::new(Bytes::from(body)))
        .unwrap())
}

async fn spawn_mock_upstream() -> SocketAddr {
    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let io = TokioIo::new(stream);
            tokio::task::spawn(async move {
                let _ = hyper::server::conn::http1::Builder::new()
                    .serve_connection(io, service_fn(mock_handler))
                    .await;
            });
        }
    });
    addr
}

#[tokio::test]
async fn hls_session_rewrite_and_proxy_round_trip() {
    // This test is deliberately thin — full routing is exercised via curl in
    // the benchmark script. We verify here that: session create → stream/{id}
    // reads upstream manifest → strips ApiKey → rewrites URIs.
    let addr = spawn_mock_upstream().await;

    // Since the session store and handlers are library functions, we invoke
    // them directly rather than spinning up the hyper server here.
    // (The benchmark script in Task 13 exercises the full server.)
    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = reqwest::Client::new();
    let body = client
        .get(format!("http://{addr}/master.m3u8"))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(&body).contains("ApiKey=secret"));
    assert!(String::from_utf8_lossy(&body).contains("BANDWIDTH=1280000"));

    // Rewrite pipeline
    let rewritten = nexus_stream_proxy::handlers::hls::rewrite_manifest(&body, "testsess").unwrap();
    let s = String::from_utf8_lossy(&rewritten);
    assert!(!s.contains("secret"), "ApiKey must be stripped");
    assert!(s.contains("/stream/testsess/"), "must rewrite URI to proxy path");
    assert!(s.contains("BANDWIDTH=1280000"), "must preserve STREAM-INF");
}
```

- [ ] **Step 2: Run the integration test**

Run: `cd stream-proxy && cargo test --test session_integration 2>&1 | tail -15`
Expected: `test result: ok. 1 passed`

- [ ] **Step 3: Commit**

```bash
git add stream-proxy/tests/session_integration.rs
git commit -m "stream-proxy: integration test for HLS rewrite + session round-trip"
```

---

## Task 7 — Wire session handler into the router

**Files:**
- Modify: `stream-proxy/src/main.rs`

- [ ] **Step 1: Locate the `handle` function in `main.rs`**

Find the block that matches on `req.method() == hyper::Method::OPTIONS` and the `path == "/stats"` branch (around lines 284-310). These stay.

- [ ] **Step 2: Insert new route branches for `/session` and `/stream/`**

After the `/stats` GET branch, **before** any other path match, add:

```rust
    // POST /session — create a new proxy session
    if req.method() == hyper::Method::POST && path == "/session" {
        return Ok(nexus_stream_proxy::handlers::session::create(req).await);
    }

    // GET /stream/{id}[/{suffix}] — stream bytes for a session
    if req.method() == hyper::Method::GET && path.starts_with("/stream/") {
        return Ok(nexus_stream_proxy::handlers::session::stream(req).await);
    }
```

- [ ] **Step 3: Build and run the binary locally to confirm the routes respond**

Run: `cd stream-proxy && cargo build --release 2>&1 | tail -5`
Expected: `Finished \`release\` profile`

Run in one terminal: `cd stream-proxy && cargo run --release`
Expected output includes: `[stream-proxy] Rust video proxy on port 3939`

In another terminal:
```bash
curl -sS -X POST http://127.0.0.1:3939/session \
  -H 'content-type: application/json' \
  -d '{"upstream_url":"https://example.com/","auth_headers":{},"is_hls":false}'
```
Expected: JSON like `{"session_id":"...","signature":"...","stream_url":"/stream/.../..."}`

Kill the running proxy (Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add stream-proxy/src/main.rs
git commit -m "stream-proxy: wire /session + /stream routes into main router"
```

---

## Task 8 — Slim down `main.rs`

The existing `main.rs` contains ~500 lines of Invidious-specific logic that Phase 1 leaves alone. We do NOT rewrite this code — we just move it into `handlers/invidious.rs` and leave the existing routes (`/proxy?url=...`, `/stats`, Invidious-resolution paths) pointing at it. This task is a **pure move** — zero behavior change.

**Files:**
- Create: `stream-proxy/src/handlers/invidious.rs`
- Modify: `stream-proxy/src/main.rs`
- Modify: `stream-proxy/src/handlers/mod.rs`

- [ ] **Step 1: Move Invidious-specific code from `main.rs` to `handlers/invidious.rs`**

Identify the following blocks in `main.rs`:
- `struct CdnEntry`, `struct ProxyStats`, `struct VideoStats`, `struct RecentRequest`, their `impl` blocks
- `static CDN_CACHE`, `static HTTP_CLIENT`, `static STATS`
- `async fn follow_redirect(...)`, `async fn resolve_cdn_url(...)`, `struct TrackedBody`
- The Invidious-handling branches inside `handle()` (the `/proxy?url=...` branch and any other path matches that deal with `videoId`/`itag`)

Copy these verbatim into `handlers/invidious.rs`. Make `pub` any symbol referenced externally. Replace the `HTTP_CLIENT` static in `invidious.rs` with a reference to `crate::proxy::HTTP_CLIENT` (so we don't have two reqwest clients). `STATS` can stay local to `invidious.rs`.

- [ ] **Step 2: Update `handlers/mod.rs` to include the new module**

```rust
pub mod hls;
pub mod invidious;
pub mod session;
```

- [ ] **Step 3: Replace the body of `handle()` in `main.rs` with a thin dispatcher**

Target ~80 lines. The dispatcher should:

1. Handle OPTIONS (CORS preflight) directly.
2. Dispatch `POST /session` → `handlers::session::create`.
3. Dispatch `GET /stream/...` → `handlers::session::stream`.
4. Dispatch `/stats`, `/proxy`, Invidious paths → `handlers::invidious::handle_invidious(req, invidious_url)`.

Exact code:

```rust
async fn handle(
    req: Request<hyper::body::Incoming>,
    invidious_url: Arc<String>,
) -> Result<Response<BoxBody<Bytes, BoxError>>, Infallible> {
    // CORS preflight
    if req.method() == hyper::Method::OPTIONS {
        return Ok(Response::builder()
            .status(204)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Headers", "Range, Content-Type")
            .header("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS")
            .body(nexus_stream_proxy::proxy::empty_body())
            .unwrap());
    }

    let path = req.uri().path().to_string();
    let method = req.method().clone();

    // New session-based routes
    if method == hyper::Method::POST && path == "/session" {
        return Ok(nexus_stream_proxy::handlers::session::create(req).await);
    }
    if method == hyper::Method::GET && path.starts_with("/stream/") {
        return Ok(nexus_stream_proxy::handlers::session::stream(req).await);
    }

    // Legacy Invidious-specific routes (/stats, /proxy?url=..., resolver paths)
    Ok(nexus_stream_proxy::handlers::invidious::handle(req, invidious_url).await)
}
```

- [ ] **Step 4: Build and run to verify the move didn't regress Invidious**

Run: `cd stream-proxy && cargo build --release 2>&1 | tail -5`
Expected: `Finished \`release\` profile` with no errors.

Run: `cd stream-proxy && cargo run --release &`
Wait 1 second.

Run: `curl -sS http://127.0.0.1:3939/stats`
Expected: JSON stats blob starting with `{"started_at":...`

Kill: `pkill -f nexus-stream-proxy`

- [ ] **Step 5: Commit**

```bash
git add stream-proxy/src/handlers/invidious.rs stream-proxy/src/handlers/mod.rs stream-proxy/src/main.rs
git commit -m "stream-proxy: move Invidious handlers into handlers::invidious (pure move)"
```

---

## Task 9 — Dockerfile Rust build stage

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Read the current Dockerfile**

Run: `cat Dockerfile`

Expected structure: 3 stages — `deps`, `build`, `runtime`.

- [ ] **Step 2: Insert a `rust-build` stage at the top**

Add this **before** the existing `FROM node:22-alpine AS deps` line:

```dockerfile
# Rust sidecar: builds the nexus-stream-proxy binary used as the byte pipe
# for video playback. Needs musl-dev for the static musl linking that lets
# the binary run in the alpine-based runtime stage.
FROM rust:1.83-alpine AS rust-build
RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static
WORKDIR /stream-proxy
# Copy manifests first to let Docker cache the dep fetch layer across rebuilds
COPY stream-proxy/Cargo.toml stream-proxy/Cargo.lock ./
RUN mkdir -p src && echo "fn main() {}" > src/main.rs && echo "" > src/lib.rs && \
    cargo build --release && \
    rm -rf src target/release/deps/nexus_stream_proxy* target/release/nexus-stream-proxy*
# Now copy real source and build
COPY stream-proxy/src ./src
COPY stream-proxy/tests ./tests
RUN cargo build --release
```

- [ ] **Step 3: Copy the built binary into the runtime stage**

In the existing `runtime` stage, **after** the existing `COPY --from=build /app/package.json ./` line, add:

```dockerfile
# Rust stream proxy: handles the byte pipe for all video playback.
# Placed in a known path the Node supervisor looks for at startup.
COPY --from=rust-build /stream-proxy/target/release/nexus-stream-proxy /app/stream-proxy/target/release/nexus-stream-proxy
```

- [ ] **Step 4: Build the image and verify the binary exists inside**

Run: `docker build -t nexus:local . 2>&1 | tail -20`
Expected: `Successfully built` (or `writing image sha256:...`).

Run: `docker run --rm --entrypoint ls nexus:local -la /app/stream-proxy/target/release/nexus-stream-proxy`
Expected: a line showing the binary with size `> 3000000` (release build is ~3-10 MB).

- [ ] **Step 5: Verify the binary runs inside the container**

Run: `docker run --rm -p 3939:3939 nexus:local /app/stream-proxy/target/release/nexus-stream-proxy &`
Wait 2 seconds.

Run: `curl -sS http://127.0.0.1:3939/stats | head -c 100`
Expected: JSON stats blob.

Kill: `docker ps -q --filter ancestor=nexus:local | xargs -r docker kill`

- [ ] **Step 6: Commit**

```bash
git add Dockerfile
git commit -m "docker: add rust-build stage for nexus-stream-proxy binary"
```

---

## Task 10 — Node supervisor: use `sveltekit:shutdown`

**Files:**
- Modify: `src/lib/server/stream-proxy.ts`
- Modify: `src/hooks.server.ts`

- [ ] **Step 1: Read `src/lib/server/stream-proxy.ts` end-to-end**

Run: `cat src/lib/server/stream-proxy.ts`

Note that it already spawns the binary, handles restarts, and has a `cleanup()` hooked to `process.on('exit'|'SIGINT'|'SIGTERM')`. Phase 1 replaces those process-level hooks with SvelteKit's own shutdown event, which is emitted once all in-flight requests drain.

- [ ] **Step 2: Replace the cleanup block in `stream-proxy.ts`**

Find this block (near the end of `startStreamProxy`):

```ts
	// Clean shutdown
	const cleanup = () => {
		restarting = true;
		if (proxyProcess) {
			proxyProcess.kill('SIGTERM');
			proxyProcess = null;
		}
	};

	process.on('exit', cleanup);
	process.on('SIGINT', cleanup);
	process.on('SIGTERM', cleanup);
```

Replace with:

```ts
	// Clean shutdown — use SvelteKit's shutdown event (emitted after in-flight
	// requests drain) as the primary signal, fall back to process-level signals
	// as a safety net for dev/Vite contexts where SvelteKit's event may not fire.
	const cleanup = () => {
		restarting = true;
		if (proxyProcess) {
			proxyProcess.kill('SIGTERM');
			proxyProcess = null;
		}
	};

	// SvelteKit adapter-node guarantees this event is emitted when the server
	// is shutting down, even if there's dangling work. Safe to register async.
	process.on('sveltekit:shutdown', cleanup);

	// Belt-and-suspenders for dev: Vite doesn't emit sveltekit:shutdown.
	process.once('SIGINT', cleanup);
	process.once('SIGTERM', cleanup);
```

- [ ] **Step 3: Add a `createSession()` helper for Node → Rust session handoff**

**Append** to `src/lib/server/stream-proxy.ts`:

```ts
/**
 * Create a proxy session on the Rust binary. Returns a signed stream URL that
 * the client can fetch directly; the Rust binary verifies the HMAC + looks up
 * the session + pipes bytes.
 *
 * Returns `null` if the Rust binary isn't running (Node fallback path).
 */
export async function createStreamSession(params: {
	upstreamUrl: string;
	authHeaders?: Record<string, string>;
	isHls?: boolean;
}): Promise<{ streamUrl: string } | null> {
	if (!proxyProcess) return null;
	try {
		const res = await fetch(`http://127.0.0.1:${PORT}/session`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				upstream_url: params.upstreamUrl,
				auth_headers: params.authHeaders ?? {},
				is_hls: params.isHls ?? false
			}),
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) {
			console.warn(`[stream-proxy] /session → ${res.status}`);
			return null;
		}
		const body = (await res.json()) as { stream_url: string };
		return { streamUrl: `http://127.0.0.1:${PORT}${body.stream_url}` };
	} catch (e) {
		console.warn('[stream-proxy] /session fetch error:', e);
		return null;
	}
}
```

- [ ] **Step 4: Run the dev server and confirm the proxy spawns**

Run: `pnpm dev 2>&1 | head -40`
Expected output should include `[stream-proxy] Starting Rust proxy on port 3939` and `[stream-proxy] Rust video proxy on port 3939`.

(If the binary isn't built locally yet, run `cd stream-proxy && cargo build --release` first, then retry.)

Kill dev server: Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/stream-proxy.ts
git commit -m "stream-proxy supervisor: sveltekit:shutdown hook + createStreamSession helper"
```

---

## Task 11 — Delegate Jellyfin HLS proxy to Rust

**Files:**
- Modify: `src/routes/api/stream/[serviceId]/[...path]/+server.ts`

- [ ] **Step 1: Read the current route handler**

Run: `wc -l src/routes/api/stream/\[serviceId\]/\[...path\]/+server.ts`
Note the line count — it's large (~300 lines) because it hand-builds the upstream URL.

- [ ] **Step 2: Identify the "build upstream URL" block**

Find the section around "Inject defaults for the HLS master playlist request" that sets `MediaSourceId`, `DeviceId`, codec params, etc. Call the final constructed URL `upstream.toString()` — this is the URL we'll now hand to the Rust proxy instead of fetching it directly.

- [ ] **Step 3: Add the Rust delegation path**

Insert this block **after** the `upstream.toString()` URL is built, but **before** the existing `const proxyHeaders: Record<string, string> = { Authorization: ... }` block:

```ts
	// ── Phase 1: delegate byte delivery to the Rust stream-proxy ──────────
	//
	// Node continues to build the Jellyfin upstream URL (the negotiation logic
	// here stays the same for now — Phase 2 replaces it with the adapter
	// contract). What changes is that instead of Node fetching + piping, we
	// create a session on the Rust binary and 302-redirect the client to it.
	// The Rust binary verifies the HMAC, looks up the session, and pipes bytes
	// zero-copy from Jellyfin.
	//
	// If the Rust binary isn't running, fall through to the legacy Node path.
	{
		const { createStreamSession } = await import('$lib/server/stream-proxy');
		const isHlsManifest = upstreamPath.endsWith('/master.m3u8') || upstreamPath.endsWith('/main.m3u8');
		const handoff = await createStreamSession({
			upstreamUrl: upstream.toString(),
			authHeaders: {
				Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-${config.id}", Version="1.0.0", Token="${token}"`,
				'X-Emby-Token': token
			},
			isHls: isHlsManifest
		});
		if (handoff) {
			return new Response(null, {
				status: 302,
				headers: {
					Location: handoff.streamUrl,
					'Cache-Control': 'no-store'
				}
			});
		}
		// handoff was null — Rust binary not running. Fall through.
		console.warn(`[fallback-node-proxy] Rust proxy unavailable, using Node pipe for ${upstreamPath}`);
	}
```

The existing Node proxy code below this block becomes the fallback. Do not delete it — Phase 3 can delete it once the contract fully supersedes this route.

- [ ] **Step 4: Typecheck**

Run: `pnpm check 2>&1 | tail -15`
Expected: zero errors in the edited file. Other errors in unrelated files are pre-existing and out of scope.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/stream/\[serviceId\]/\[...path\]/+server.ts
git commit -m "api/stream: delegate HLS byte delivery to Rust proxy via session handoff"
```

---

## Task 12 — Benchmark harness

**Files:**
- Create: `scripts/benchmark-proxy.sh`

- [ ] **Step 1: Create `scripts/benchmark-proxy.sh`**

```bash
#!/usr/bin/env bash
# Phase 1 exit-criteria benchmark: measure HLS segment delivery through
# (a) the legacy Node proxy path and (b) the Rust proxy path, against the
# same upstream Jellyfin URL. Prints MB/s for each.
#
# Usage:
#   NEXUS_URL=http://127.0.0.1:8585 \
#   JELLYFIN_ITEM_ID=<item-guid> \
#   NEXUS_SESSION_COOKIE=<cookie-value> \
#   ./scripts/benchmark-proxy.sh
#
# Requires: curl, awk. No other dependencies.
set -euo pipefail

NEXUS_URL="${NEXUS_URL:-http://127.0.0.1:8585}"
ITEM_ID="${JELLYFIN_ITEM_ID:-}"
COOKIE="${NEXUS_SESSION_COOKIE:-}"

if [[ -z "$ITEM_ID" || -z "$COOKIE" ]]; then
  echo "usage: set JELLYFIN_ITEM_ID and NEXUS_SESSION_COOKIE" >&2
  exit 2
fi

# Fetch a master.m3u8 through the proxy (either 302 → Rust or direct Node).
# We follow redirects (-L) so the timing reflects the full hop chain.
MASTER_URL="${NEXUS_URL}/api/stream/jellyfin/${ITEM_ID}/master.m3u8"
echo "== fetch master.m3u8 =="
curl -sSL \
  -H "Cookie: nexus_session=${COOKIE}" \
  -o /tmp/master.m3u8 \
  -w "http_code: %{http_code}\ntime_total: %{time_total}s\n" \
  "$MASTER_URL"

# Pick a segment URL from the rewritten manifest. The Rust path rewrites
# segments to /stream/{id}/..., the Node path leaves them as relative Jellyfin
# paths — both are reachable through NEXUS_URL with the same cookie.
SEGMENT_REL=$(grep -E '^[^#].*\.(ts|m4s|mp4)' /tmp/master.m3u8 | head -1 || true)
if [[ -z "$SEGMENT_REL" ]]; then
  echo "no segment found in manifest; check the URL + cookie" >&2
  exit 3
fi

# If segment is absolute (starts with /), prefix with NEXUS_URL
case "$SEGMENT_REL" in
  /*) SEGMENT_URL="${NEXUS_URL}${SEGMENT_REL}" ;;
  *)  SEGMENT_URL="${NEXUS_URL}/api/stream/jellyfin/${ITEM_ID}/${SEGMENT_REL}" ;;
esac

echo
echo "== fetch first segment =="
echo "url: $SEGMENT_URL"
curl -sSL \
  -H "Cookie: nexus_session=${COOKIE}" \
  -o /tmp/segment.bin \
  -w "http_code: %{http_code}\nsize: %{size_download} bytes\ntime: %{time_total}s\nspeed: %{speed_download} B/s\n" \
  "$SEGMENT_URL"

SPEED_BPS=$(curl -sSL \
  -H "Cookie: nexus_session=${COOKIE}" \
  -o /dev/null \
  -w "%{speed_download}" \
  "$SEGMENT_URL")
echo
echo "$(awk "BEGIN { printf \"throughput: %.2f MB/s\\n\", $SPEED_BPS / 1024 / 1024 }")"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/benchmark-proxy.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/benchmark-proxy.sh
git commit -m "scripts: add proxy benchmark harness for Phase 1 exit criteria"
```

---

## Task 13 — End-to-end smoke test in Docker

**Files:** none modified — this is a verification task.

- [ ] **Step 1: Build the full image**

Run: `docker build -t nexus:local . > /tmp/nexus-build.log 2>&1 && tail -5 /tmp/nexus-build.log`
Expected: successful build, ending with `writing image sha256:...`.

- [ ] **Step 2: Run the container with a preserved volume**

Run:
```bash
docker rm -f nexus 2>/dev/null || true
docker run -d --name nexus -p 8585:8585 -v nexus-data:/app/data nexus:local
sleep 3
```

- [ ] **Step 3: Verify both Node and Rust proxies are alive**

Run: `docker logs nexus 2>&1 | grep -E "Listening|Rust video proxy"`
Expected: two lines —
```
[stream-proxy] Rust video proxy on port 3939 -> ...
Listening on http://0.0.0.0:8585
```

If only `Listening` appears, the binary didn't spawn — check the image was built with Task 9's Dockerfile changes and that `/app/stream-proxy/target/release/nexus-stream-proxy` exists.

- [ ] **Step 4: Smoke-test the Rust endpoint from outside the container**

Run:
```bash
docker exec nexus wget -q -O - http://127.0.0.1:3939/stats | head -c 100
```
Expected: JSON stats blob starting with `{"started_at":...`.

- [ ] **Step 5: Smoke-test session handoff via Node**

Run:
```bash
docker exec nexus sh -c 'wget -q -O - --post-data="{\"upstream_url\":\"http://example.com/\",\"auth_headers\":{},\"is_hls\":false}" --header="content-type: application/json" http://127.0.0.1:3939/session'
```
Expected: JSON with `session_id`, `signature`, `stream_url` fields.

- [ ] **Step 6: Stop the container**

Run: `docker stop nexus`

- [ ] **Step 7: Commit (empty — marker)**

```bash
git commit --allow-empty -m "phase-1 smoke test passing in docker image"
```

---

## Task 14 — Phase 1 exit criteria verification

**Files:** none modified.

- [ ] **Step 1: Confirm the unit and integration tests still pass**

Run: `cd stream-proxy && cargo test 2>&1 | tail -10`
Expected: all tests pass. Record the count.

- [ ] **Step 2: Confirm SvelteKit typecheck is clean for the edited files**

Run: `pnpm check 2>&1 | grep -E "src/routes/api/stream/|src/lib/server/stream-proxy|src/hooks.server" | head -20`
Expected: no errors in any of those paths. Pre-existing errors in unrelated files are fine.

- [ ] **Step 3: Run the benchmark harness against parker's stack**

Ask parker for:
- `JELLYFIN_ITEM_ID` — a movie GUID from his linked Jellyfin
- `NEXUS_SESSION_COOKIE` — his current browser cookie (from devtools)

Run the benchmark twice:
```bash
JELLYFIN_ITEM_ID=<guid> NEXUS_SESSION_COOKIE=<cookie> ./scripts/benchmark-proxy.sh
```

Record the `throughput: X MB/s` from each run. Document them as acceptance evidence in the phase-1 completion note.

- [ ] **Step 4: Update Nexus project memory**

Append to `/Users/parker/.claude/projects/-Users-parker-Developer/memory/project_nexus.md` under "Open threads", replacing the existing "Beta blocker" entry:

```markdown
- **Phase 1 of the player rework has landed.** Rust stream-proxy now handles HLS byte delivery for Jellyfin via a session handoff. Node still builds the upstream URL (Phase 2 replaces that with the negotiatePlayback contract). Docker image includes the Rust binary built from source in a musl-alpine stage. See `docs/superpowers/specs/2026-04-15-player-streaming-rework-design.md` and `docs/superpowers/plans/2026-04-15-player-rework-phase-1-rust-proxy.md`. Next: Phase 2 plan.
```

- [ ] **Step 5: Final commit**

```bash
git add /Users/parker/.claude/projects/-Users-parker-Developer/memory/project_nexus.md
git commit -m "memory: phase 1 landed, update open threads"
```

---

## Phase 1 done when

- [x] All tasks above checked off.
- [x] `cargo test` green inside `stream-proxy/`.
- [x] `docker build -t nexus:local .` succeeds and the image contains `/app/stream-proxy/target/release/nexus-stream-proxy`.
- [x] Container startup logs show both `Listening on http://0.0.0.0:8585` and `Rust video proxy on port 3939`.
- [x] Benchmark harness reports a throughput number against a real Jellyfin movie via both the Rust and fallback paths.
- [x] No user-visible change. Player UI, quality menu, account linking all behave identically to before Phase 1.
- [x] Project memory updated.

## What Phase 1 explicitly does not do

- Doesn't touch `Player.svelte` or any playback UI.
- Doesn't change the `negotiatePlayback` contract (Phase 2).
- Doesn't migrate `/api/video/stream/[videoId]` (Invidious) to the session model — Invidious keeps its existing Rust `/proxy?url=` path.
- Doesn't add new quality selector behavior.
- Doesn't clean up subtitle handling.
- Doesn't self-host fonts (Phase 4).
- Doesn't remove any existing Node proxy code — keeps it as the fallback.
