use crate::cache;
use crate::handlers::hls::rewrite_manifest;
use crate::proxy::{
    cached_or_stream, full_body, stream_upstream_response, BoxError, HTTP_CLIENT,
};
use crate::session::{self as session_store, AdapterKind, Session};
use http_body_util::{combinators::BoxBody, BodyExt};
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
    #[serde(default = "default_url_prefix_body")]
    pub url_prefix: String,
    #[serde(default)]
    pub kind: AdapterKind,
}

fn default_url_prefix_body() -> String {
    "/stream/".to_string()
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
        url_prefix: parsed.url_prefix,
        kind: parsed.kind,
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
    let path = uri.path().to_string();
    let query = uri.query().unwrap_or("").to_string();

    let mut parts = path.trim_start_matches("/stream/").splitn(2, '/');
    let session_id = match parts.next() {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => return json_error(StatusCode::NOT_FOUND, "no session id"),
    };
    let suffix = parts.next().map(|s| s.to_string());

    let sig = query
        .split('&')
        .find_map(|p| p.strip_prefix("sig="))
        .unwrap_or("")
        .to_string();
    if !session_store::verify(&session_id, &sig) {
        return json_error(StatusCode::FORBIDDEN, "invalid signature");
    }

    let session = match session_store::get(&session_id) {
        Some(s) => s,
        None => return json_error(StatusCode::NOT_FOUND, "unknown session"),
    };

    // Figure out the upstream URL for this hit:
    // - root hit → session.upstream_url (typically master.m3u8)
    // - subpath hit → decode hex, resolve relative to upstream origin
    let upstream_url = match &suffix {
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

    // Adapter-specific upstream URL rewriting. Plex's transcoder generates
    // TS segments lazily; without waitForSegments=1 the server returns 404
    // for segments not yet emitted, so we enforce it on every hop. Other
    // adapters get the URL as-is.
    let upstream_url = adapter_rewrite_upstream_url(session.kind, upstream_url);

    // Non-HLS session: use cached_or_stream so segment-sized bodies hit the
    // cache and trigger prefetch. proxy_stream stays for pure passthrough
    // (e.g. ranged requests — cached_or_stream detects and delegates).
    if !session.is_hls {
        return cached_or_stream(&upstream_url, &session.auth_headers, req.headers()).await;
    }

    // HLS session: if the URL looks like a segment (not a manifest), take
    // the cached path — most requests within an HLS session are segments,
    // and caching them is the whole point of the proxy-side readahead.
    if !cache::is_manifest_url(&upstream_url) {
        return cached_or_stream(&upstream_url, &session.auth_headers, req.headers()).await;
    }

    // Manifest: fetch with auth, buffer, rewrite so segment URIs route
    // back through our signed /stream/:id/:suffix path.
    let mut req_builder = HTTP_CLIENT.get(&upstream_url);
    for (k, v) in &session.auth_headers {
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
        || upstream_url.ends_with(".m3u8");

    if !is_manifest {
        // URL looked like a manifest but server returned binary. Stream it
        // through without caching — we can't rely on our cacheable heuristics
        // for content that lied about its type.
        return stream_upstream_response(upstream).await;
    }

    let body = match upstream.bytes().await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[stream-proxy] manifest body read: {e}");
            return json_error(StatusCode::BAD_GATEWAY, "upstream body");
        }
    };
    let sig = session_store::sign(&session_id);
    let rewritten = match rewrite_manifest(&body, &session_id, &sig, &session.url_prefix, &upstream_url, session.kind) {
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

/// Dispatch upstream-URL rewriting based on which adapter produced this
/// session. The default path is identity — only adapters with known quirks
/// get bespoke handling here, and those quirks stay contained to this file.
fn adapter_rewrite_upstream_url(kind: AdapterKind, url: String) -> String {
    match kind {
        AdapterKind::Plex => ensure_plex_wait_for_segments(url),
        AdapterKind::Jellyfin | AdapterKind::Generic => url,
    }
}

/// Append `waitForSegments=1` to any URL under the Plex
/// `/video/:/transcode/universal/` path, unless already present. Plex's
/// transcoder generates segments lazily and returns 404 for not-yet-emitted
/// ones; this flag makes the server block until the segment exists.
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

/// Resolve `sub` against the session's base URL, honoring standard relative-URL
/// rules. Three cases:
///
/// 1. `sub` is already absolute (`http://...` or `https://...`) — return it as-is.
/// 2. `sub` is origin-absolute (starts with `/`) — prepend the base's origin.
///    Base `http://jf.local/Videos/abc/master.m3u8` + sub `/Users/foo/items`
///    → `http://jf.local/Users/foo/items`.
/// 3. `sub` is path-relative (no leading `/`) — resolve against the base's
///    parent directory. Base `http://jf.local/Videos/abc/master.m3u8` + sub
///    `live.m3u8?x=1` → `http://jf.local/Videos/abc/live.m3u8?x=1`. Jellyfin
///    emits variant URIs this way in master playlists, so the path-relative
///    branch is load-bearing for HLS playback.
fn resolve_relative(base: &str, sub: &str) -> String {
    if sub.starts_with("http://") || sub.starts_with("https://") {
        return sub.to_string();
    }

    // Strip any query string from the base before computing the parent directory.
    let base_no_query = base.split('?').next().unwrap_or(base);

    let origin_end = base_no_query
        .find("://")
        .and_then(|i| base_no_query[i + 3..].find('/').map(|j| i + 3 + j))
        .unwrap_or(base_no_query.len());
    let origin = &base_no_query[..origin_end];

    if sub.starts_with('/') {
        return format!("{origin}{sub}");
    }

    // Path-relative: take the base's directory (everything up to and including
    // the last `/`) and append the sub verbatim. The sub may contain a query
    // string — that's preserved as part of the returned URL.
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

    #[test]
    fn resolve_relative_handles_path_relative_urls() {
        // Jellyfin emits variant URIs like `live.m3u8?...` in master playlists.
        // These are relative to the master's parent directory.
        assert_eq!(
            resolve_relative(
                "http://jellyfin.local/Videos/abc/master.m3u8",
                "live.m3u8?MaxStreamingBitrate=120000000"
            ),
            "http://jellyfin.local/Videos/abc/live.m3u8?MaxStreamingBitrate=120000000"
        );
    }

    #[test]
    fn resolve_relative_strips_base_query_before_resolving() {
        // Base URL may carry its own query — it should not leak into the
        // resolved path.
        assert_eq!(
            resolve_relative(
                "http://jf.local/Videos/abc/master.m3u8?DeviceId=nexus",
                "live.m3u8"
            ),
            "http://jf.local/Videos/abc/live.m3u8"
        );
    }

    #[test]
    fn ensure_plex_wait_for_segments_appends_to_plex_urls() {
        assert_eq!(
            ensure_plex_wait_for_segments(
                "http://plex.local/video/:/transcode/universal/start.m3u8?path=/lib/123"
                    .to_string()
            ),
            "http://plex.local/video/:/transcode/universal/start.m3u8?path=/lib/123&waitForSegments=1"
        );
    }

    #[test]
    fn ensure_plex_wait_for_segments_is_idempotent() {
        let u = "http://plex.local/video/:/transcode/universal/00001.ts?waitForSegments=1"
            .to_string();
        assert_eq!(ensure_plex_wait_for_segments(u.clone()), u);
    }

    #[test]
    fn ensure_plex_wait_for_segments_leaves_jellyfin_alone() {
        let u = "http://jf.local/Videos/abc/hls1/main/0.ts".to_string();
        assert_eq!(ensure_plex_wait_for_segments(u.clone()), u);
    }

    #[test]
    fn ensure_plex_wait_for_segments_handles_no_query() {
        assert_eq!(
            ensure_plex_wait_for_segments(
                "http://plex.local/video/:/transcode/universal/session/abc/base/0.ts".to_string()
            ),
            "http://plex.local/video/:/transcode/universal/session/abc/base/0.ts?waitForSegments=1"
        );
    }
}
