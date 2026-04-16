use crate::cache::{self, CACHE, MAX_SEGMENT_BYTES};
use futures_util::TryStreamExt;
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
        // Raise from 32 — segment fanout + prefetch can saturate a smaller pool
        // during startup when the player requests initial manifest + 4 segments
        // concurrently.
        .pool_max_idle_per_host(64)
        // Enable HTTP/2 with an adaptive flow-control window. When upstream
        // advertises h2 via ALPN (most HTTPS media servers), reqwest will
        // multiplex concurrent segment fetches over a single TCP connection
        // instead of opening six and paying TLS handshake cost each time.
        .http2_adaptive_window(true)
        .build()
        .expect("reqwest client build")
});

/// Headers we forward from client → upstream. Any other client header is dropped.
///
/// `accept-encoding` is forwarded so compressed manifests (some Jellyfin
/// reverse proxies gzip them) transit unmodified to the browser, which can
/// decompress natively. We don't enable reqwest's own decompression features,
/// so encoded bodies stream through without re-encoding.
const FORWARDED_REQUEST_HEADERS: &[&str] = &[
    "range",
    "if-none-match",
    "if-modified-since",
    "accept-encoding",
];

/// Headers we forward from upstream → client. Any other upstream header is dropped.
const FORWARDED_RESPONSE_HEADERS: &[&str] = &[
    "content-type",
    "content-length",
    "content-range",
    "content-encoding",
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
            // Log full error (including URL) to stderr, return a generic
            // body so ApiKey-bearing URLs don't leak to the client.
            eprintln!("[stream-proxy] upstream fetch error: {e}");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(full_body("upstream error"))
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

/// Check the segment cache for `upstream_url`. On hit: serve the cached body
/// directly with no upstream round-trip. On miss: fetch, insert to cache if
/// eligible, and spawn a prefetch for the next few URLs in the sequence.
///
/// `extra_upstream_headers` is the session's auth header bundle (used both
/// for the foreground fetch and the spawned prefetches). `client_headers` is
/// the raw browser request; we filter to [`FORWARDED_REQUEST_HEADERS`].
///
/// Ranged requests (`Range: bytes=...`) bypass the cache — we'd need
/// byte-range accounting to cache them correctly, and players mostly use
/// full-segment GETs anyway.
pub async fn cached_or_stream(
    upstream_url: &str,
    extra_upstream_headers: &HashMap<String, String>,
    client_headers: &HeaderMap,
) -> Response<BoxBody<Bytes, BoxError>> {
    let is_ranged = client_headers.get("range").is_some();
    let skip_cache = is_ranged || cache::is_manifest_url(upstream_url);

    if !skip_cache {
        if let Some(cached) = CACHE.get(upstream_url) {
            // Still spawn a prefetch on a cache hit — we want to stay ahead
            // of the player even during steady-state playback.
            let next = cache::predict_next_urls(upstream_url, cache::PREFETCH_COUNT);
            cache::spawn_prefetch(next, extra_upstream_headers.clone());
            return Response::builder()
                .status(200)
                .header("content-type", cached.content_type.clone())
                .header("content-length", cached.body.len())
                .header("cache-control", "no-store")
                .body(full_body(cached.body.clone()))
                .unwrap();
        }
    }

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
                .body(full_body("upstream error"))
                .unwrap();
        }
    };

    let status = upstream.status();
    let content_length = upstream.content_length();
    let content_type = upstream
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    // Cache iff: successful, not a ranged response, not a manifest, and
    // content_length is known and within our per-segment cap. Unknown
    // content-length means streaming/chunked — don't buffer.
    let cacheable = !skip_cache
        && status.is_success()
        && content_length.map(|n| n <= MAX_SEGMENT_BYTES as u64).unwrap_or(false);

    if !cacheable {
        // Stream through without caching. This is the path for manifests
        // (handled by caller already), progressive streams, and ranged
        // requests.
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
        return builder.body(StreamBody::new(stream).boxed()).unwrap();
    }

    // Buffer, cache, and serve. Then spawn prefetch for the next URLs.
    let body = match upstream.bytes().await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[stream-proxy] segment body read error: {e}");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(full_body("upstream body error"))
                .unwrap();
        }
    };

    CACHE.insert(upstream_url.to_string(), body.clone(), content_type.clone());
    let next = cache::predict_next_urls(upstream_url, cache::PREFETCH_COUNT);
    cache::spawn_prefetch(next, extra_upstream_headers.clone());

    Response::builder()
        .status(status.as_u16())
        .header("content-type", content_type)
        .header("content-length", body.len())
        .header("cache-control", "no-store")
        .body(full_body(body))
        .unwrap()
}

/// Pipe an already-fetched `reqwest::Response` through as a hyper `Response`
/// without buffering. Used by the session handler when it has to inspect
/// the upstream content-type before deciding whether to rewrite or stream.
pub async fn stream_upstream_response(
    upstream: reqwest::Response,
) -> Response<BoxBody<Bytes, BoxError>> {
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
