use crate::handlers::hls::rewrite_manifest;
use crate::proxy::{full_body, proxy_stream, stream_upstream_response, BoxError, HTTP_CLIENT};
use crate::session::{self as session_store, Session};
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

    // For HLS sessions we need to inspect every upstream response to decide
    // whether to run the manifest rewriter. Non-HLS sessions always stream
    // bytes straight through.
    if !session.is_hls {
        return proxy_stream(&upstream_url, &session.auth_headers, req.headers()).await;
    }

    // HLS session: fetch the upstream with auth headers + client range
    // headers, then decide whether to rewrite or stream based on content.
    let mut req_builder = HTTP_CLIENT.get(&upstream_url);
    for (k, v) in &session.auth_headers {
        req_builder = req_builder.header(k, v);
    }
    // Forward range headers for seekable segment requests
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
        // Segment, init fragment, key, or other binary content — stream bytes.
        return stream_upstream_response(upstream).await;
    }

    // Manifest: buffer it fully, rewrite, serve.
    let body = match upstream.bytes().await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[stream-proxy] manifest body read: {e}");
            return json_error(StatusCode::BAD_GATEWAY, "upstream body");
        }
    };
    let sig = session_store::sign(&session_id);
    let rewritten = match rewrite_manifest(&body, &session_id, &sig) {
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
