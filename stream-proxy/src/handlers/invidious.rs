use dashmap::DashMap;
use futures_util::TryStreamExt;
use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::body::{Bytes, Frame};
use hyper::{Request, Response, StatusCode};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::proxy::{cached_or_stream, empty_body, full_body, BoxError, HTTP_CLIENT as PROXY_HTTP_CLIENT};
use crate::session::{self, HeldCred};
use std::collections::HashMap;

// ── CDN cache ──────────────────────────────────────────────────────────────

struct CdnEntry {
    url: String,
    expires: Instant,
}

static CDN_CACHE: LazyLock<DashMap<String, CdnEntry>> = LazyLock::new(DashMap::new);

/// Invidious-specific HTTP client: no automatic redirects (we follow them
/// manually in follow_redirect), short timeout, small idle pool.
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(10)
        .build()
        .unwrap()
});

// ── Stats tracking ─────────────────────────────────────────────────────────

static STATS: LazyLock<ProxyStats> = LazyLock::new(ProxyStats::new);

struct ProxyStats {
    started_at: u64,
    total_requests: AtomicU64,
    active_connections: AtomicU64,
    bytes_served: AtomicU64,
    cache_hits: AtomicU64,
    cache_misses: AtomicU64,
    errors: AtomicU64,
    /// Per-video stats: key = videoId, value = VideoStats
    videos: DashMap<String, VideoStats>,
    /// Recent requests log (last 50)
    recent: DashMap<u64, RecentRequest>,
    recent_counter: AtomicU64,
}

struct VideoStats {
    requests: AtomicU64,
    bytes: AtomicU64,
    last_accessed: AtomicU64,
    itags: DashMap<String, AtomicU64>,
}

struct RecentRequest {
    timestamp: u64,
    video_id: String,
    itag: String,
    status: u16,
    bytes: u64,
    duration_ms: u64,
    cached: bool,
}

impl ProxyStats {
    fn new() -> Self {
        Self {
            started_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            total_requests: AtomicU64::new(0),
            active_connections: AtomicU64::new(0),
            bytes_served: AtomicU64::new(0),
            cache_hits: AtomicU64::new(0),
            cache_misses: AtomicU64::new(0),
            errors: AtomicU64::new(0),
            videos: DashMap::new(),
            recent: DashMap::new(),
            recent_counter: AtomicU64::new(0),
        }
    }

    fn record_request(
        &self,
        video_id: &str,
        itag: &str,
        status: u16,
        bytes: u64,
        duration_ms: u64,
        cached: bool,
    ) {
        self.total_requests.fetch_add(1, Ordering::Relaxed);
        self.bytes_served.fetch_add(bytes, Ordering::Relaxed);

        if cached {
            self.cache_hits.fetch_add(1, Ordering::Relaxed);
        } else {
            self.cache_misses.fetch_add(1, Ordering::Relaxed);
        }

        if status >= 400 {
            self.errors.fetch_add(1, Ordering::Relaxed);
        }

        // Per-video stats
        let entry = self
            .videos
            .entry(video_id.to_string())
            .or_insert_with(|| VideoStats {
                requests: AtomicU64::new(0),
                bytes: AtomicU64::new(0),
                last_accessed: AtomicU64::new(0),
                itags: DashMap::new(),
            });
        entry.requests.fetch_add(1, Ordering::Relaxed);
        entry.bytes.fetch_add(bytes, Ordering::Relaxed);
        entry.last_accessed.store(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            Ordering::Relaxed,
        );
        let itag_counter = entry
            .itags
            .entry(itag.to_string())
            .or_insert_with(|| AtomicU64::new(0));
        itag_counter.fetch_add(1, Ordering::Relaxed);

        // Recent log (ring buffer of 50)
        let idx = self.recent_counter.fetch_add(1, Ordering::Relaxed) % 50;
        self.recent.insert(
            idx,
            RecentRequest {
                timestamp: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
                video_id: video_id.to_string(),
                itag: itag.to_string(),
                status,
                bytes,
                duration_ms,
                cached,
            },
        );
    }

    fn to_json(&self) -> String {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let uptime = now - self.started_at;

        let mut videos_json = Vec::new();
        for entry in self.videos.iter() {
            let mut itags_json = Vec::new();
            for itag in entry.itags.iter() {
                itags_json.push(format!(
                    "\"{}\":{}",
                    itag.key(),
                    itag.value().load(Ordering::Relaxed)
                ));
            }
            videos_json.push(format!(
                "{{\"videoId\":\"{}\",\"requests\":{},\"bytes\":{},\"lastAccessed\":{},\"itags\":{{{}}}}}",
                entry.key(),
                entry.requests.load(Ordering::Relaxed),
                entry.bytes.load(Ordering::Relaxed),
                entry.last_accessed.load(Ordering::Relaxed),
                itags_json.join(",")
            ));
        }

        let mut recent_json = Vec::new();
        let mut recent_entries: Vec<_> = self
            .recent
            .iter()
            .map(|r| {
                (
                    r.timestamp,
                    r.video_id.clone(),
                    r.itag.clone(),
                    r.status,
                    r.bytes,
                    r.duration_ms,
                    r.cached,
                )
            })
            .collect();
        recent_entries.sort_by(|a, b| b.0.cmp(&a.0));
        for (ts, vid, itag, status, bytes, dur, cached) in recent_entries.iter().take(20) {
            recent_json.push(format!(
                "{{\"timestamp\":{ts},\"videoId\":\"{vid}\",\"itag\":\"{itag}\",\"status\":{status},\"bytes\":{bytes},\"durationMs\":{dur},\"cached\":{cached}}}"
            ));
        }

        format!(
            "{{\"uptime\":{},\"totalRequests\":{},\"activeConnections\":{},\"bytesServed\":{},\"cacheHits\":{},\"cacheMisses\":{},\"errors\":{},\"cachedUrls\":{},\"videos\":[{}],\"recent\":[{}]}}",
            uptime,
            self.total_requests.load(Ordering::Relaxed),
            self.active_connections.load(Ordering::Relaxed),
            self.bytes_served.load(Ordering::Relaxed),
            self.cache_hits.load(Ordering::Relaxed),
            self.cache_misses.load(Ordering::Relaxed),
            self.errors.load(Ordering::Relaxed),
            CDN_CACHE.len(),
            videos_json.join(","),
            recent_json.join(",")
        )
    }
}

// ── CDN resolution ─────────────────────────────────────────────────────────

async fn follow_redirect(url: &str) -> Option<String> {
    let resp = HTTP_CLIENT
        .head(url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?;

    if resp.status().is_redirection() {
        resp.headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .map(String::from)
    } else {
        None
    }
}

async fn resolve_cdn_url(invidious_url: &str, video_id: &str, itag: &str) -> (Option<String>, bool) {
    let cache_key = format!("{video_id}:{itag}");

    if let Some(entry) = CDN_CACHE.get(&cache_key) {
        if entry.expires > Instant::now() {
            return (Some(entry.url.clone()), true);
        }
    }

    let inv_url = format!(
        "{}/latest_version?id={}&itag={}",
        invidious_url,
        urlencoding::encode(video_id),
        urlencoding::encode(itag)
    );
    let mut location = match follow_redirect(&inv_url).await {
        Some(l) => l,
        None => return (None, false),
    };

    if location.contains("/companion/") {
        if let Some(cdn) = follow_redirect(&location).await {
            location = cdn;
        }
    }

    CDN_CACHE.insert(
        cache_key,
        CdnEntry {
            url: location.clone(),
            expires: Instant::now() + Duration::from_secs(300),
        },
    );

    (Some(location), false)
}

// ── Request handler ────────────────────────────────────────────────────────

pub async fn handle(
    req: Request<hyper::body::Incoming>,
    invidious_url: Arc<String>,
) -> Response<BoxBody<Bytes, BoxError>> {
    let path = req.uri().path();

    // Stats endpoint: GET /stats
    if path == "/stats" {
        let json = STATS.to_json();
        return Response::builder()
            .status(200)
            .header("Content-Type", "application/json")
            .header("Access-Control-Allow-Origin", "*")
            .body(Full::new(Bytes::from(json)).map_err(|e| -> BoxError { Box::new(e) }).boxed())
            .unwrap();
    }

    let query = req.uri().query().unwrap_or("");

    // ── Direct CDN proxy: /proxy?url=<encoded-cdn-url> ──────────────────────
    // Used by DASH manifests — passes exact CDN URL, preserves byte ranges
    if path == "/proxy" {
        let cdn_url = match query.split('&').find_map(|p| p.strip_prefix("url=")) {
            Some(encoded) => urlencoding::decode(encoded).unwrap_or_default().into_owned(),
            None => {
                return Response::builder().status(400).body(empty_body()).unwrap();
            }
        };

        let start = Instant::now();
        STATS.active_connections.fetch_add(1, Ordering::Relaxed);

        // Extract video ID and itag from CDN URL for stats
        let vid = cdn_url
            .split("id=")
            .nth(1)
            .and_then(|s| s.split('&').next())
            .unwrap_or("unknown")
            .to_string();
        let itag = cdn_url
            .split("itag=")
            .nth(1)
            .and_then(|s| s.split('&').next())
            .unwrap_or("?")
            .to_string();

        let mut upstream_req = HTTP_CLIENT
            .get(&cdn_url)
            .timeout(Duration::from_secs(30));
        if let Some(range) = req.headers().get("range") {
            if let Ok(range_str) = range.to_str() {
                upstream_req = upstream_req.header("Range", range_str);
            }
        }

        let upstream = match upstream_req.send().await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[stream-proxy] CDN proxy error: {e}");
                STATS.active_connections.fetch_sub(1, Ordering::Relaxed);
                STATS.errors.fetch_add(1, Ordering::Relaxed);
                return Response::builder().status(502).body(empty_body()).unwrap();
            }
        };

        let status = upstream.status().as_u16();
        let content_type = upstream
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("video/mp4")
            .to_string();
        let content_length = upstream
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        let content_length_val: u64 = content_length
            .as_ref()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let content_range = upstream
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .map(String::from);

        STATS.record_request(&vid, &itag, status, content_length_val, start.elapsed().as_millis() as u64, false);

        let stream = upstream
            .bytes_stream()
            .map_ok(Frame::data)
            .map_err(|e| -> BoxError { Box::new(e) });
        let body = StreamBody::new(stream);
        let tracked_body = TrackedBody { inner: body.boxed() };

        let mut builder = Response::builder()
            .status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK))
            .header("Content-Type", content_type)
            .header("Accept-Ranges", "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "private, max-age=3600");

        if let Some(cl) = content_length {
            builder = builder.header("Content-Length", cl);
        }
        if let Some(cr) = content_range {
            builder = builder.header("Content-Range", cr);
        }

        return builder.body(tracked_body.boxed()).unwrap();
    }

    // ── Legacy /stream/{videoId}?itag=NNN (non-DASH fallback) ───────────────
    let video_id = match path.strip_prefix("/stream/") {
        Some(id) if !id.is_empty() => urlencoding::decode(id).unwrap_or_default().into_owned(),
        _ => {
            return Response::builder()
                .status(404)
                .body(empty_body())
                .unwrap()
        }
    };

    let itag = query
        .split('&')
        .find_map(|p| p.strip_prefix("itag="))
        .unwrap_or("299");

    let start = Instant::now();
    STATS.active_connections.fetch_add(1, Ordering::Relaxed);

    let (cdn_url, was_cached) = resolve_cdn_url(&invidious_url, &video_id, itag).await;
    let cdn_url = match cdn_url {
        Some(url) => url,
        None => {
            STATS.active_connections.fetch_sub(1, Ordering::Relaxed);
            STATS.record_request(&video_id, itag, 502, 0, start.elapsed().as_millis() as u64, false);
            return Response::builder()
                .status(502)
                .body(empty_body())
                .unwrap();
        }
    };

    let range_header = req.headers().get("range").and_then(|v| v.to_str().ok()).map(String::from);

    // Try fetching from CDN, retry once with fresh URL on 416/403
    let (upstream, final_cached) = {
        let mut current_url = cdn_url;
        let mut cached = was_cached;

        loop {
            let mut upstream_req = HTTP_CLIENT.get(&current_url);
            if let Some(ref range_str) = range_header {
                upstream_req = upstream_req.header("Range", range_str.as_str());
            }

            match upstream_req.send().await {
                Ok(r) => {
                    let status = r.status().as_u16();
                    if cached && (status == 416 || status == 403) {
                        let cache_key = format!("{video_id}:{itag}");
                        CDN_CACHE.remove(&cache_key);
                        eprintln!("[stream-proxy] Got {status} from cached CDN URL, re-resolving {video_id}:{itag}");

                        match resolve_cdn_url(&invidious_url, &video_id, itag).await {
                            (Some(new_url), _) => {
                                current_url = new_url;
                                cached = false;
                                continue;
                            }
                            (None, _) => {
                                STATS.active_connections.fetch_sub(1, Ordering::Relaxed);
                                STATS.record_request(&video_id, itag, 502, 0, start.elapsed().as_millis() as u64, false);
                                return Response::builder().status(502).body(empty_body()).unwrap();
                            }
                        }
                    }
                    break (r, cached);
                }
                Err(e) => {
                    CDN_CACHE.remove(&format!("{video_id}:{itag}"));
                    eprintln!("[stream-proxy] CDN fetch error: {e}");
                    STATS.active_connections.fetch_sub(1, Ordering::Relaxed);
                    STATS.record_request(&video_id, itag, 502, 0, start.elapsed().as_millis() as u64, cached);
                    return Response::builder().status(502).body(empty_body()).unwrap();
                }
            }
        }
    };

    let status = upstream.status().as_u16();
    let content_type = upstream
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/mp4")
        .to_string();
    let content_length = upstream
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let content_length_val: u64 = content_length
        .as_ref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let content_range = upstream
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    // Record stats
    let vid = video_id.clone();
    let itag_owned = itag.to_string();
    STATS.record_request(&vid, &itag_owned, status, content_length_val, start.elapsed().as_millis() as u64, final_cached);

    // Stream the body, decrement active connections when done
    let stream = upstream
        .bytes_stream()
        .map_ok(Frame::data)
        .map_err(|e| -> BoxError { Box::new(e) });

    let body = StreamBody::new(stream);

    // Wrap to track connection close
    let tracked_body = TrackedBody {
        inner: body.boxed(),
    };

    let mut builder = Response::builder()
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK))
        .header("Content-Type", content_type)
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "private, max-age=3600");

    if let Some(cl) = content_length {
        builder = builder.header("Content-Length", cl);
    }
    if let Some(cr) = content_range {
        builder = builder.header("Content-Range", cr);
    }

    builder.body(tracked_body.boxed()).unwrap()
}

/// Invidious-style grant entry: `GET /v/{id}/...?grant=<token>`.
///
/// Shares the grant-verify + held-cred spine with the Jellyfin `/stream` route.
/// The grant binds `{backend, resource_ref=videoId, user_id}`; the proxy holds
/// the Invidious service cred and fetches everything through the instance origin
/// (`local=true` upstreams), so the injected auth is always the Nexus service
/// token, never the browser's. Range passthrough + segment cache via
/// `cached_or_stream`.
///
/// Path shapes (the `id` is the videoId the grant authorizes):
///   /v/{id}                  → progressive/dash entry, resource_ref resolution
///   /v/{id}/seg/{hex}        → an instance-anchored segment (hex = upstream path)
///   /v/{id}/captions?label=  → caption proxy
pub async fn handle_v(
    req: Request<hyper::body::Incoming>,
    invidious_url: Arc<String>,
) -> Response<BoxBody<Bytes, BoxError>> {
    let path = req.uri().path().to_string();
    let query = req.uri().query().unwrap_or("").to_string();

    let grant_token = match query.split('&').find_map(|p| p.strip_prefix("grant=")) {
        Some(g) => urlencoding::decode(g).map(|c| c.into_owned()).unwrap_or_else(|_| g.to_string()),
        None => return forbidden("missing grant"),
    };

    // Identity binding via the seam-stamped header (back-compat: "legacy").
    let expected_user = req
        .headers()
        .get("x-nexus-user")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("legacy")
        .to_string();

    let grant = match session::verify_grant(&grant_token, &expected_user, 0) {
        Ok(g) => g,
        Err(e) => {
            eprintln!("[stream-proxy] /v grant rejected: {e:?}");
            return forbidden("invalid grant");
        }
    };

    // Resolve the held Invidious cred fail-closed. The instance base comes from
    // the held cred if present, else the env INVIDIOUS_URL (anon/public path —
    // Invidious content needs no auth).
    let (base, auth_headers): (String, HashMap<String, String>) =
        match session::held_cred(&grant.claims.backend) {
            Some(HeldCred {
                base_url,
                auth_header_name,
                auth_header_value,
            }) => {
                let mut h = HashMap::new();
                if !auth_header_name.is_empty() {
                    h.insert(auth_header_name, auth_header_value);
                }
                (base_url, h)
            }
            // No held cred: Invidious content is public; fall back to the env
            // instance origin. This is still grant-gated (verified above).
            None => ((*invidious_url).clone(), HashMap::new()),
        };

    // Parse `/v/{id}/...` — the {id} segment must match the grant's resource_ref
    // (the videoId the grant authorizes), else reject (resource scoping).
    let rest = path.trim_start_matches("/v/");
    let mut parts = rest.splitn(2, '/');
    let id = parts.next().unwrap_or("");
    let tail = parts.next().unwrap_or("");
    if id.is_empty() || id != grant.claims.resource_ref {
        return forbidden("grant/resource mismatch");
    }

    // ── DASH manifest entry: GET /v/{id}/dash?grant=<token> ─────────────────
    // Fetch the instance DASH manifest (following the 302 to /companion/...),
    // rewrite every per-Representation <BaseURL> so the byte-range segment
    // fetches route back through this proxy carrying the SAME grant, and serve
    // the rewritten MPD. The child hops land on the `seg/{hex}` branch below,
    // which decodes the instance-relative path and streams it with Range
    // passthrough via cached_or_stream.
    if tail == "dash" {
        let manifest_url = format!(
            "{}/api/manifest/dash/id/{}?local=true",
            base.trim_end_matches('/'),
            urlencoding::encode(id)
        );
        // PROXY_HTTP_CLIENT follows redirects (limited(5)), so the 302 to the
        // relative /companion/... MPD resolves in a single GET.
        let mut req_builder = PROXY_HTTP_CLIENT.get(&manifest_url);
        for (k, v) in &auth_headers {
            req_builder = req_builder.header(k, v);
        }
        let upstream = match req_builder.send().await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[stream-proxy] DASH manifest fetch error: {e}");
                return bad_gateway("dash upstream error");
            }
        };
        let status = upstream.status().as_u16();
        let mpd = match upstream.text().await {
            Ok(t) => t,
            Err(e) => {
                eprintln!("[stream-proxy] DASH manifest body read: {e}");
                return bad_gateway("dash upstream body");
            }
        };
        let rewritten = rewrite_dash_manifest(&mpd, id, &grant_token);
        return Response::builder()
            .status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK))
            .header("content-type", "application/dash+xml")
            .header("cache-control", "no-store")
            .body(full_body(rewritten))
            .unwrap();
    }

    // Resolve the upstream URL against the instance origin.
    let upstream_url = if let Some(hex_path) = tail.strip_prefix("seg/") {
        // Instance-anchored segment: hex-decode the upstream path.
        let bytes = match hex::decode(hex_path.split('?').next().unwrap_or(hex_path)) {
            Ok(b) => b,
            Err(_) => return bad_request("bad seg hex"),
        };
        let sub = match std::str::from_utf8(&bytes) {
            Ok(s) => s.to_string(),
            Err(_) => return bad_request("seg not utf-8"),
        };
        // SECURITY (adversarial review): `sub` is attacker-controlled (hex from the
        // URL). join_instance passes absolute URLs through verbatim → SSRF + held-
        // cred exfil to any host. Constrain to instance-relative companion/
        // videoplayback paths (the same allowlist the DASH rewriter emits) and
        // re-anchor to the configured instance. Anything else is rejected.
        let safe = match instance_relative_path(&sub) {
            Some(p) => p,
            None => return forbidden("segment path not allowed"),
        };
        join_instance(&base, &safe)
    } else if tail == "captions" {
        // Caption proxy: /api/v1/captions/{id}?<query minus grant>.
        let kept = strip_grant(&query);
        if kept.is_empty() {
            format!("{}/api/v1/captions/{}", base.trim_end_matches('/'), id)
        } else {
            format!("{}/api/v1/captions/{}?{}", base.trim_end_matches('/'), id, kept)
        }
    } else {
        // Entry hit: the resource_ref is treated as an instance-relative path the
        // adapter baked at mint time (e.g. a DASH manifest or latest_version URL).
        // For Phase-0 the resource_ref IS the videoId; resolve to the canonical
        // progressive entry. The adapter-build phase refines this mapping.
        format!(
            "{}/latest_version?id={}&local=true",
            base.trim_end_matches('/'),
            urlencoding::encode(id)
        )
    };

    cached_or_stream(&upstream_url, &auth_headers, req.headers()).await
}

fn join_instance(base: &str, sub: &str) -> String {
    if sub.starts_with("http://") || sub.starts_with("https://") {
        return sub.to_string();
    }
    let b = base.trim_end_matches('/');
    if sub.starts_with('/') {
        format!("{b}{sub}")
    } else {
        format!("{b}/{sub}")
    }
}

/// URL-prefix the proxy anchors child hops under. Matches how the HLS rewrite
/// roots its grant URLs (the Nexus stream-proxy mount).
const URL_PREFIX: &str = "/api/stream-proxy/";

/// Rewrite every `<BaseURL>...</BaseURL>` in a DASH MPD whose inner content is
/// an instance-relative path (`/companion/...` or `/videoplayback...`, in either
/// relative or absolute-to-instance form) into a grant-bearing proxy URL:
///   `{URL_PREFIX}v/{id}/seg/{HEX}?grant={grant}`
/// where HEX = lowercase hex of the UTF-8 bytes of the instance path `P` (the
/// `seg/{hex}` branch decodes this back and resolves it against the instance
/// origin via join_instance). The `&` in the emitted query is XML-escaped to
/// `&amp;` since it lives inside the MPD.
fn rewrite_dash_manifest(mpd: &str, id: &str, grant: &str) -> String {
    let open = "<BaseURL>";
    let close = "</BaseURL>";
    let mut out = String::with_capacity(mpd.len());
    let mut rest = mpd;
    while let Some(start) = rest.find(open) {
        let after_open = start + open.len();
        let inner_end = match rest[after_open..].find(close) {
            Some(i) => after_open + i,
            None => break, // unbalanced tag — emit the remainder verbatim below
        };
        // Emit everything up to and including the open tag.
        out.push_str(&rest[..after_open]);
        let inner_raw = &rest[after_open..inner_end];
        // MPD content is XML-escaped (`&amp;`); decode to the real path before
        // hex-encoding so the round-trip path matches the upstream exactly.
        let inner = inner_raw.replace("&amp;", "&");
        if let Some(path) = instance_relative_path(&inner) {
            let hex = hex::encode(path.as_bytes());
            let replacement = format!(
                "{URL_PREFIX}v/{}/seg/{}?grant={}",
                id,
                hex,
                urlencoding::encode(grant)
            );
            // XML-escape the `&` between query params for valid MPD content.
            out.push_str(&replacement.replace('&', "&amp;"));
        } else {
            out.push_str(inner_raw);
        }
        out.push_str(close);
        rest = &rest[inner_end + close.len()..];
    }
    out.push_str(rest);
    out
}

/// If `inner` references an instance-relative companion/videoplayback resource,
/// return the path component to anchor against the instance origin (leading
/// slash preserved). Accepts both relative (`/companion/...`, `/videoplayback`)
/// and absolute-to-instance (`http(s)://host/companion/...`) forms; returns the
/// origin-relative path in both cases. Returns None for anything else.
fn instance_relative_path(inner: &str) -> Option<String> {
    let trimmed = inner.trim();
    if trimmed.starts_with("/companion/") || trimmed.starts_with("/videoplayback") {
        return Some(trimmed.to_string());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        // Strip scheme://host, keep the origin-relative path+query.
        let after_scheme = trimmed.splitn(2, "://").nth(1)?;
        let slash = after_scheme.find('/')?;
        let path = &after_scheme[slash..];
        if path.starts_with("/companion/") || path.starts_with("/videoplayback") {
            return Some(path.to_string());
        }
    }
    None
}

fn strip_grant(query: &str) -> String {
    query
        .split('&')
        .filter(|p| !p.starts_with("grant="))
        .collect::<Vec<_>>()
        .join("&")
}

fn forbidden(msg: &str) -> Response<BoxBody<Bytes, BoxError>> {
    Response::builder()
        .status(403)
        .header("content-type", "application/json")
        .body(full_body(serde_json::json!({ "error": msg }).to_string()))
        .unwrap()
}

fn bad_request(msg: &str) -> Response<BoxBody<Bytes, BoxError>> {
    Response::builder()
        .status(400)
        .header("content-type", "application/json")
        .body(full_body(serde_json::json!({ "error": msg }).to_string()))
        .unwrap()
}

fn bad_gateway(msg: &str) -> Response<BoxBody<Bytes, BoxError>> {
    Response::builder()
        .status(502)
        .header("content-type", "application/json")
        .body(full_body(serde_json::json!({ "error": msg }).to_string()))
        .unwrap()
}

/// Body wrapper that decrements active connections when dropped
struct TrackedBody {
    inner: BoxBody<Bytes, BoxError>,
}

impl hyper::body::Body for TrackedBody {
    type Data = Bytes;
    type Error = BoxError;

    fn poll_frame(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        std::pin::Pin::new(&mut self.inner).poll_frame(cx)
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> hyper::body::SizeHint {
        self.inner.size_hint()
    }
}

impl Drop for TrackedBody {
    fn drop(&mut self) {
        STATS.active_connections.fetch_sub(1, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_relative_path_accepts_relative_companion() {
        assert_eq!(
            instance_relative_path("/companion/videoplayback?expire=1&id=x").as_deref(),
            Some("/companion/videoplayback?expire=1&id=x")
        );
        assert_eq!(
            instance_relative_path("/videoplayback?foo=bar").as_deref(),
            Some("/videoplayback?foo=bar")
        );
    }

    #[test]
    fn instance_relative_path_strips_absolute_origin() {
        assert_eq!(
            instance_relative_path("https://inv.local/companion/videoplayback?a=1").as_deref(),
            Some("/companion/videoplayback?a=1")
        );
    }

    #[test]
    fn instance_relative_path_rejects_foreign() {
        assert_eq!(instance_relative_path("https://googlevideo.com/x"), None);
        assert_eq!(instance_relative_path("/api/v1/something"), None);
        assert_eq!(instance_relative_path("relative/path"), None);
    }

    #[test]
    fn rewrite_dash_rewrites_baseurl_with_grant() {
        let mpd = r#"<MPD><Period><AdaptationSet><Representation id="137"><BaseURL>/companion/videoplayback?expire=1&amp;id=abc&amp;itag=137</BaseURL><SegmentBase indexRange="0-100"/></Representation></AdaptationSet></Period></MPD>"#;
        let out = rewrite_dash_manifest(mpd, "VIDID", "v4.local.TOK");
        // Path P = /companion/videoplayback?expire=1&id=abc&itag=137 (decoded).
        let expected_hex =
            hex::encode("/companion/videoplayback?expire=1&id=abc&itag=137".as_bytes());
        assert!(
            out.contains(&format!("/api/stream-proxy/v/VIDID/seg/{expected_hex}?grant=v4.local.TOK")),
            "got: {out}"
        );
        assert!(out.contains("seg/"), "rewrote BaseURL");
        // No raw unescaped `&` may leak into MPD content; all are `&amp;`.
        assert!(
            !out.replace("&amp;", "").contains('&'),
            "every & must be XML-escaped: {out}"
        );
        assert!(!out.contains("/companion/videoplayback?expire"), "original path replaced");
        // Structure preserved.
        assert!(out.contains("<SegmentBase indexRange=\"0-100\"/>"));
        assert!(out.contains("<Representation id=\"137\">"));
    }

    #[test]
    fn rewrite_dash_leaves_foreign_baseurls() {
        let mpd = "<MPD><BaseURL>https://googlevideo.com/keep</BaseURL></MPD>";
        let out = rewrite_dash_manifest(mpd, "ID", "TOK");
        assert_eq!(out, mpd, "non-instance BaseURL left untouched");
    }

    #[test]
    fn rewrite_dash_roundtrips_to_seg_path() {
        // The emitted hex must decode (after un-escaping) to the instance path so
        // the seg/{hex} branch resolves it against the origin via join_instance.
        let mpd = "<MPD><BaseURL>/companion/videoplayback?id=z</BaseURL></MPD>";
        let out = rewrite_dash_manifest(mpd, "ID", "TOK");
        let hex_part = out
            .split("seg/")
            .nth(1)
            .and_then(|s| s.split('?').next())
            .unwrap();
        let decoded = String::from_utf8(hex::decode(hex_part).unwrap()).unwrap();
        assert_eq!(decoded, "/companion/videoplayback?id=z");
        assert_eq!(
            join_instance("http://inv.local", &decoded),
            "http://inv.local/companion/videoplayback?id=z"
        );
    }
}
