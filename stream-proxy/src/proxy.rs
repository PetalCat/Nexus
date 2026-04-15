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
