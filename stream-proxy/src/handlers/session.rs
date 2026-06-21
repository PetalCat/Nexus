//! `/session` (Jellyfin-style) entry route.
//!
//! The browser-facing token is the PASETO v4.local grant (`?grant=`); there is
//! no stored session id and no HMAC. `POST /session` verifies a grant, then
//! returns a grant-bearing stream URL. `GET /stream?grant=...[&suffix=hex]`
//! verifies the grant on every hit and streams bytes through, holding the
//! service credential server-side.
//!
//! TRANSITION NOTE: the existing adapter handoff still supplies the upstream URL
//! + auth headers inline (pre-grant adapter shape). For that path the proxy
//! registers the inline cred under a `inline:<digest>` backend keyed off the
//! grant's resource_ref, so the cred is held server-side (never in the browser
//! URL) while the full adapter migration to backend-resolved held creds lands in
//! the adapter-build phase. Native held-cred resolution (no inline registry) is
//! used by the Invidious `/v/...` route and is the target shape for Jellyfin too.

use crate::cache;
use crate::handlers::hls::rewrite_manifest;
use crate::proxy::{cached_or_stream, full_body, stream_upstream_response, BoxError, HTTP_CLIENT};
use crate::session::{self, AdapterKind, HeldCred, VerifyError};
use dashmap::DashMap;
use http_body_util::{combinators::BoxBody, BodyExt};
use hyper::body::{Bytes, Incoming};
use hyper::{Request, Response, StatusCode};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::LazyLock;

/// Inline-cred registry for the back-compat adapter handoff. Keyed by a stable
/// digest of the grant's resource_ref. Stateless held-cred resolution (the
/// `/v/...` route) does NOT use this; it reads the env-injected table.
static INLINE_CREDS: LazyLock<DashMap<String, InlineSession>> = LazyLock::new(DashMap::new);

#[derive(Clone)]
struct InlineSession {
    upstream_url: String,
    auth_headers: HashMap<String, String>,
    is_hls: bool,
    url_prefix: String,
    kind: AdapterKind,
}

#[derive(Debug, Deserialize)]
pub struct CreateSessionBody {
    /// The PASETO v4.local grant minted by Node. Verified before anything else.
    pub grant: String,
    /// Inline upstream URL (back-compat adapter shape; held server-side).
    pub upstream_url: String,
    #[serde(default)]
    pub auth_headers: HashMap<String, String>,
    #[serde(default)]
    pub is_hls: bool,
    #[serde(default = "default_url_prefix_body")]
    pub url_prefix: String,
    #[serde(default)]
    pub kind: AdapterKind,
}

fn default_url_prefix_body() -> String {
    "/stream/".to_string()
}

/// Stable digest of an inline resource_ref → the registry key. Hex of a simple
/// FNV-1a hash; collision-resistant enough for an in-process transition map.
fn inline_key(resource_ref: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in resource_ref.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("inline:{h:016x}")
}

/// `POST /session`: verify the grant, register the inline cred, return a
/// grant-bearing stream URL. The grant — not a session id — is what the browser
/// carries back.
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

    // Verify the grant up front. We don't yet know the seam-stamped user here in
    // the back-compat path, so we bind to the grant's own minted user: the mint
    // side sets user_id, and the inline path mints with a known user (default
    // "legacy"). We re-derive the implicit assertion from that. Since the inline
    // mint uses user "legacy" or the passed userId and gen 0, verify with the
    // same. If a future seam stamps a header we use it instead.
    let expected_user = "legacy";
    let grant = match session::verify_grant(&parsed.grant, expected_user, 0) {
        Ok(g) => g,
        Err(e) => return verify_reject("/session", e),
    };

    // Register the inline cred under a key derived from the grant's resource_ref
    // so /stream can recover it statelessly-enough (in-process) on each hit.
    let key = inline_key(&grant.claims.resource_ref);
    INLINE_CREDS.insert(
        key.clone(),
        InlineSession {
            upstream_url: parsed.upstream_url,
            auth_headers: parsed.auth_headers,
            is_hls: parsed.is_hls,
            url_prefix: parsed.url_prefix.clone(),
            kind: parsed.kind,
        },
    );

    // The stream URL carries the grant (credential-free). The browser comes back
    // to GET /stream?grant=<token>.
    let stream_url = format!("/stream?grant={}", urlencoding::encode(&parsed.grant));
    let body = serde_json::json!({ "stream_url": stream_url }).to_string();
    Response::builder()
        .status(200)
        .header("content-type", "application/json")
        .body(full_body(body))
        .unwrap()
}

/// `GET /stream?grant=<token>[&suffix=<hex>]`: verify the grant, resolve the
/// inline cred, fetch upstream injecting the held auth, stream back. HLS
/// manifests are rewritten so child hops route back through the proxy with the
/// same grant.
pub async fn stream(req: Request<Incoming>) -> Response<BoxBody<Bytes, BoxError>> {
    let uri = req.uri().clone();
    let query = uri.query().unwrap_or("").to_string();

    let grant_token = match query_param(&query, "grant") {
        Some(g) => g,
        None => return json_error(StatusCode::FORBIDDEN, "missing grant"),
    };
    let suffix = query_param(&query, "suffix");

    // Identity binding: prefer the seam-stamped X-Nexus-User header; fall back to
    // the back-compat "legacy" user. The implicit assertion (and thus the tag)
    // is reconstructed from this — a token minted for a different user fails.
    let expected_user = req
        .headers()
        .get("x-nexus-user")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("legacy")
        .to_string();

    let grant = match session::verify_grant(&grant_token, &expected_user, 0) {
        Ok(g) => g,
        Err(e) => return verify_reject("/stream", e),
    };

    // Resolve the held cred. Prefer the env held-cred table by backend; fall back
    // to the inline registry for the back-compat path.
    let (upstream_base, auth_headers, is_hls, url_prefix, kind) =
        match session::held_cred(&grant.claims.backend) {
            Some(HeldCred {
                base_url,
                auth_header_name,
                auth_header_value,
            }) => {
                // Held-cred mode: resource_ref is the path under base_url; the
                // grant is the only authority. HLS-ness is inferred from suffix
                // or resource_ref extension.
                let mut h = HashMap::new();
                h.insert(auth_header_name, auth_header_value);
                let is_hls = grant.claims.resource_ref.ends_with(".m3u8")
                    || suffix.as_deref().map(is_m3u8).unwrap_or(false);
                (base_url, h, is_hls, "/stream".to_string(), AdapterKind::Generic)
            }
            None => {
                // Inline back-compat mode.
                let key = inline_key(&grant.claims.resource_ref);
                match INLINE_CREDS.get(&key) {
                    Some(s) => (
                        s.upstream_url.clone(),
                        s.auth_headers.clone(),
                        s.is_hls,
                        s.url_prefix.clone(),
                        s.kind,
                    ),
                    None => {
                        // Unknown backend AND no inline session → fail closed.
                        return json_error(StatusCode::FORBIDDEN, "unknown backend");
                    }
                }
            }
        };

    // Compute the upstream URL for this hit.
    let upstream_url = match &suffix {
        None => upstream_base.clone(),
        Some(encoded) => {
            let bytes = match hex::decode(encoded) {
                Ok(b) => b,
                Err(_) => return json_error(StatusCode::BAD_REQUEST, "bad encoded suffix"),
            };
            let sub = match std::str::from_utf8(&bytes) {
                Ok(s) => s.to_string(),
                Err(_) => return json_error(StatusCode::BAD_REQUEST, "suffix not utf-8"),
            };
            resolve_relative(&upstream_base, &sub)
        }
    };

    let upstream_url = adapter_rewrite_upstream_url(kind, upstream_url);

    if !is_hls {
        return cached_or_stream(&upstream_url, &auth_headers, req.headers()).await;
    }
    if !cache::is_manifest_url(&upstream_url) {
        return cached_or_stream(&upstream_url, &auth_headers, req.headers()).await;
    }

    // Manifest: fetch with held auth, rewrite child URIs back through the proxy
    // with this same grant.
    let mut req_builder = HTTP_CLIENT.get(&upstream_url);
    for (k, v) in &auth_headers {
        req_builder = req_builder.header(k, v);
    }
    if let Some(range) = req.headers().get("range") {
        if let Ok(v) = range.to_str() {
            req_builder = req_builder.header("range", v);
        }
    }
    let upstream = match req_builder.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[stream-proxy] HLS upstream fetch error: {e}");
            return json_error(StatusCode::BAD_GATEWAY, "upstream error");
        }
    };
    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let is_manifest = content_type.starts_with("application/vnd.apple.mpegurl")
        || content_type.starts_with("application/x-mpegurl")
        || content_type.starts_with("audio/mpegurl")
        || upstream_url.contains(".m3u8");
    if !is_manifest {
        return stream_upstream_response(upstream).await;
    }
    let body = match upstream.bytes().await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[stream-proxy] manifest body read: {e}");
            return json_error(StatusCode::BAD_GATEWAY, "upstream body");
        }
    };
    let rewritten =
        match rewrite_manifest(&body, &grant_token, &url_prefix, &upstream_url, kind) {
            Ok(out) => out,
            Err(e) => {
                eprintln!("[stream-proxy] manifest rewrite error: {e}");
                return json_error(StatusCode::BAD_GATEWAY, "manifest rewrite");
            }
        };
    Response::builder()
        .status(status.as_u16())
        .header("content-type", "application/vnd.apple.mpegurl")
        .header("cache-control", "no-store")
        .body(full_body(rewritten))
        .unwrap()
}

fn is_m3u8(s: &str) -> bool {
    s.split('?').next().unwrap_or(s).ends_with(".m3u8")
}

/// Map a verify failure to a 403 (or 502 for nothing — all map to 403). The
/// reason is logged, never surfaced.
fn verify_reject(route: &str, e: VerifyError) -> Response<BoxBody<Bytes, BoxError>> {
    eprintln!("[stream-proxy] {route} grant rejected: {e:?}");
    json_error(StatusCode::FORBIDDEN, "invalid grant")
}

fn query_param(query: &str, name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    query
        .split('&')
        .find_map(|p| p.strip_prefix(&prefix))
        .map(|v| urlencoding::decode(v).map(|c| c.into_owned()).unwrap_or_else(|_| v.to_string()))
}

fn adapter_rewrite_upstream_url(kind: AdapterKind, url: String) -> String {
    match kind {
        AdapterKind::Plex => ensure_plex_wait_for_segments(url),
        AdapterKind::Jellyfin | AdapterKind::Generic => url,
    }
}

fn ensure_plex_wait_for_segments(url: String) -> String {
    if !url.contains("/transcode/universal/") {
        return url;
    }
    if url.contains("waitForSegments=") {
        return url;
    }
    if url.contains('?') {
        format!("{url}&waitForSegments=1")
    } else {
        format!("{url}?waitForSegments=1")
    }
}

fn json_error(status: StatusCode, msg: &str) -> Response<BoxBody<Bytes, BoxError>> {
    let body = serde_json::json!({ "error": msg }).to_string();
    Response::builder()
        .status(status.as_u16())
        .header("content-type", "application/json")
        .body(full_body(body))
        .unwrap()
}

/// Resolve `sub` against `base`, honoring absolute / origin-absolute /
/// path-relative URLs.
fn resolve_relative(base: &str, sub: &str) -> String {
    if sub.starts_with("http://") || sub.starts_with("https://") {
        return sub.to_string();
    }
    let base_no_query = base.split('?').next().unwrap_or(base);
    let origin_end = base_no_query
        .find("://")
        .and_then(|i| base_no_query[i + 3..].find('/').map(|j| i + 3 + j))
        .unwrap_or(base_no_query.len());
    let origin = &base_no_query[..origin_end];
    if sub.starts_with('/') {
        return format!("{origin}{sub}");
    }
    let dir_end = base_no_query.rfind('/').unwrap_or(base_no_query.len());
    let dir = &base_no_query[..=dir_end.min(base_no_query.len() - 1)];
    format!("{dir}{sub}")
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
    fn resolve_relative_handles_path_relative_urls() {
        assert_eq!(
            resolve_relative(
                "http://jellyfin.local/Videos/abc/master.m3u8",
                "live.m3u8?MaxStreamingBitrate=120000000"
            ),
            "http://jellyfin.local/Videos/abc/live.m3u8?MaxStreamingBitrate=120000000"
        );
    }

    #[test]
    fn resolve_relative_passes_through_absolute_upstream_urls() {
        assert_eq!(resolve_relative("http://a", "http://b/x"), "http://b/x");
    }

    #[test]
    fn ensure_plex_wait_for_segments_appends() {
        assert_eq!(
            ensure_plex_wait_for_segments(
                "http://plex.local/video/:/transcode/universal/start.m3u8?path=/lib/123".to_string()
            ),
            "http://plex.local/video/:/transcode/universal/start.m3u8?path=/lib/123&waitForSegments=1"
        );
    }

    #[test]
    fn ensure_plex_wait_for_segments_is_idempotent() {
        let u = "http://plex.local/video/:/transcode/universal/0.ts?waitForSegments=1".to_string();
        assert_eq!(ensure_plex_wait_for_segments(u.clone()), u);
    }

    #[test]
    fn inline_key_is_stable() {
        assert_eq!(inline_key("abc"), inline_key("abc"));
        assert_ne!(inline_key("abc"), inline_key("abd"));
    }

    #[test]
    fn query_param_extracts_and_decodes() {
        assert_eq!(
            query_param("grant=v4.local.abc&suffix=00ff", "grant").as_deref(),
            Some("v4.local.abc")
        );
        assert_eq!(
            query_param("grant=a%20b", "grant").as_deref(),
            Some("a b")
        );
        assert_eq!(query_param("x=1", "grant"), None);
    }
}
