//! Segment cache + prefetch pipeline.
//!
//! The browser is a serial consumer: it asks for segment N, plays it, then
//! asks for segment N+1. Upstream (Jellyfin, SABR proxies) can typically
//! deliver segments much faster than a video plays, so we can stay ahead of
//! the player by buffering the *next* segments while the *current* one is
//! being consumed. After the first cache miss, subsequent hits drop
//! upstream-to-client latency to "round-trip to our Rust proxy" — usually
//! sub-millisecond on localhost, a handful of ms on LAN.
//!
//! Two levers:
//!
//! - [`SegmentCache`]: a DashMap keyed by upstream URL, bytes-bounded by
//!   [`MAX_CACHE_BYTES`], with last-access-based eviction. Individual
//!   segments above [`MAX_SEGMENT_BYTES`] skip the cache to avoid a huge
//!   transcoded stream monopolizing it.
//! - [`spawn_prefetch`]: after a segment is fetched, predict the next few
//!   upstream URLs by incrementing the last numeric run in the path and kick
//!   off background fetches against those URLs, deduplicating via
//!   [`SegmentCache::mark_in_flight`].
//!
//! Prefetched segments land in the cache so the client's next request hits
//! directly. If the heuristic is wrong (URL doesn't match the next segment),
//! we waste one upstream fetch — benign; upstream already advertised those
//! bytes in the manifest, the cost is a token bucket and a little bandwidth.

use crate::proxy::HTTP_CLIENT;
use dashmap::DashMap;
use hyper::body::Bytes;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Hard cap on total cached bytes. 1 GB is roughly 2 minutes of 4K video
/// at 35 Mbps, or a whole 1080p movie at 8 Mbps (120-minute @ ~7 GB won't
/// fully fit, but the working set of "recent + next few segments" does).
pub const MAX_CACHE_BYTES: usize = 1024 * 1024 * 1024;

/// Skip caching bodies larger than this. A transcoded non-HLS progressive
/// stream can easily be several GB; we don't want one to evict everything.
pub const MAX_SEGMENT_BYTES: usize = 64 * 1024 * 1024;

/// Prefetch this many segments ahead after each segment request (both on
/// cache hits and misses). Each cache hit refreshes the window so we stay
/// `PREFETCH_COUNT` segments ahead of the player during steady-state
/// playback. At Jellyfin's default 3s segment length, 6 = ~18s readahead —
/// enough to absorb a brief upstream stall without visible rebuffering.
pub const PREFETCH_COUNT: usize = 6;

pub struct CachedSegment {
    pub body: Bytes,
    pub content_type: String,
    pub last_access_millis: AtomicU64,
}

pub struct SegmentCache {
    map: DashMap<String, Arc<CachedSegment>>,
    total_bytes: AtomicUsize,
    /// URLs currently being fetched. Prevents a duplicate upstream request
    /// when a foreground fetch and a prefetch race on the same segment.
    in_flight: DashMap<String, ()>,
}

pub static CACHE: LazyLock<SegmentCache> = LazyLock::new(SegmentCache::new);

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl SegmentCache {
    pub fn new() -> Self {
        Self {
            map: DashMap::new(),
            total_bytes: AtomicUsize::new(0),
            in_flight: DashMap::new(),
        }
    }

    pub fn get(&self, url: &str) -> Option<Arc<CachedSegment>> {
        let seg = self.map.get(url)?.clone();
        seg.last_access_millis.store(now_millis(), Ordering::Relaxed);
        Some(seg)
    }

    pub fn insert(&self, url: String, body: Bytes, content_type: String) {
        let size = body.len();
        if size > MAX_SEGMENT_BYTES {
            return;
        }
        let seg = Arc::new(CachedSegment {
            body,
            content_type,
            last_access_millis: AtomicU64::new(now_millis()),
        });
        if let Some(prev) = self.map.insert(url, seg) {
            self.total_bytes.fetch_sub(prev.body.len(), Ordering::Relaxed);
        }
        self.total_bytes.fetch_add(size, Ordering::Relaxed);
        self.evict_if_over();
    }

    /// Claim an in-flight slot for `url`. Returns true if we got it (caller
    /// should fetch); false if someone else is already fetching this URL.
    pub fn mark_in_flight(&self, url: &str) -> bool {
        self.in_flight.insert(url.to_string(), ()).is_none()
    }

    pub fn mark_done(&self, url: &str) {
        self.in_flight.remove(url);
    }

    fn evict_if_over(&self) {
        while self.total_bytes.load(Ordering::Relaxed) > MAX_CACHE_BYTES {
            // Find the LRU entry by scanning the map. DashMap iteration is
            // O(n) but only runs when we're over-capacity, and eviction
            // happens in bursts — cache usually sits under the cap.
            let mut oldest_url: Option<String> = None;
            let mut oldest_ts: u64 = u64::MAX;
            for entry in self.map.iter() {
                let ts = entry.value().last_access_millis.load(Ordering::Relaxed);
                if ts < oldest_ts {
                    oldest_ts = ts;
                    oldest_url = Some(entry.key().clone());
                }
            }
            let Some(url) = oldest_url else { break };
            if let Some((_, seg)) = self.map.remove(&url) {
                self.total_bytes.fetch_sub(seg.body.len(), Ordering::Relaxed);
            } else {
                // Raced with another eviction. Break to avoid infinite loop.
                break;
            }
        }
    }
}

/// Detect manifests by URL suffix. We never cache manifests because their
/// contents change (live segment windows, HLS live playlists, session-scoped
/// rewrites).
pub fn is_manifest_url(url: &str) -> bool {
    let path = url.split('?').next().unwrap_or(url).to_lowercase();
    path.ends_with(".m3u8") || path.ends_with(".mpd") || path.contains("/manifest")
}

/// Predict the next `count` segment URLs by incrementing the last numeric run
/// in the path. Returns an empty Vec if no digits are found (e.g. init
/// fragments like `init-stream0.m4s` — we don't try to prefetch those).
///
/// Jellyfin HLS segment URLs typically end `/0.mp4`, `/1.mp4`, ...
/// Jellyfin DASH: `chunk-stream0-00001.m4s` → increment the last run.
/// Invidious DASH companion: `/sq/0/1234` → increment.
pub fn predict_next_urls(url: &str, count: usize) -> Vec<String> {
    let (path, query) = match url.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (url, None),
    };
    // Basename = everything after the last '/'. We search within the basename
    // only — the number we care about (segment index) is in the filename,
    // not the directory structure (`/hls1/main/5.mp4` → target `5`, not the
    // `1` in `hls1`).
    let basename_start = path.rfind('/').map(|i| i + 1).unwrap_or(0);
    let basename = &path[basename_start..];
    // Strip the trailing extension so `.mp4`'s `4` doesn't masquerade as the
    // segment index. A URL with no `.` in the basename keeps the whole thing.
    let stem_end_in_basename = basename.rfind('.').unwrap_or(basename.len());
    let stem = &basename[..stem_end_in_basename];
    let stem_bytes = stem.as_bytes();

    let mut end = stem_bytes.len();
    while end > 0 && !stem_bytes[end - 1].is_ascii_digit() {
        end -= 1;
    }
    if end == 0 {
        return Vec::new();
    }
    let mut start = end;
    while start > 0 && stem_bytes[start - 1].is_ascii_digit() {
        start -= 1;
    }
    let num_str = &stem[start..end];
    let Ok(n) = num_str.parse::<u64>() else {
        return Vec::new();
    };
    let width = num_str.len();
    let abs_start = basename_start + start;
    let abs_end = basename_start + end;

    (1..=count as u64)
        .map(|i| {
            let new_num = format!("{:0>width$}", n + i, width = width);
            let mut s = String::with_capacity(url.len());
            s.push_str(&path[..abs_start]);
            s.push_str(&new_num);
            s.push_str(&path[abs_end..]);
            if let Some(q) = query {
                s.push('?');
                s.push_str(q);
            }
            s
        })
        .collect()
}

/// Spawn background fetches for each URL in `urls`, populating the cache on
/// success. Returns immediately; fetches run on the tokio runtime.
///
/// Each URL uses the same auth headers as the original request. Deduplicates
/// against both the cache (skip if already cached) and in-flight set (skip if
/// another task is already fetching).
pub fn spawn_prefetch(urls: Vec<String>, auth_headers: HashMap<String, String>) {
    for url in urls {
        if CACHE.map.contains_key(&url) {
            continue;
        }
        if !CACHE.mark_in_flight(&url) {
            continue;
        }
        let auth = auth_headers.clone();
        tokio::spawn(async move {
            let mut req = HTTP_CLIENT.get(&url);
            for (k, v) in &auth {
                req = req.header(k, v);
            }
            match req.send().await {
                Ok(resp) if resp.status().is_success() => {
                    let content_type = resp
                        .headers()
                        .get("content-type")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("application/octet-stream")
                        .to_string();
                    let size_hint = resp.content_length().unwrap_or(0) as usize;
                    if size_hint > MAX_SEGMENT_BYTES {
                        CACHE.mark_done(&url);
                        return;
                    }
                    match resp.bytes().await {
                        Ok(body) => {
                            CACHE.insert(url.clone(), body, content_type);
                        }
                        Err(e) => {
                            eprintln!("[stream-proxy:prefetch] body read {url}: {e}");
                        }
                    }
                }
                Ok(resp) => {
                    // Non-success status (403 expired signature, 404 out-of-range) — just
                    // drop the slot. No point retrying; the player may never request this
                    // URL if our prediction was wrong.
                    if !resp.status().is_success() {
                        // silent — predictions miss frequently and that's fine.
                    }
                }
                Err(e) => {
                    eprintln!("[stream-proxy:prefetch] upstream {url}: {e}");
                }
            }
            CACHE.mark_done(&url);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn predicts_incrementing_segment_index() {
        assert_eq!(
            predict_next_urls("http://jf/videos/abc/hls1/main/5.mp4?api_key=x", 3),
            vec![
                "http://jf/videos/abc/hls1/main/6.mp4?api_key=x",
                "http://jf/videos/abc/hls1/main/7.mp4?api_key=x",
                "http://jf/videos/abc/hls1/main/8.mp4?api_key=x",
            ]
        );
    }

    #[test]
    fn preserves_zero_padding() {
        // Jellyfin DASH uses zero-padded indices.
        assert_eq!(
            predict_next_urls("http://jf/dash/chunk-stream0-00042.m4s", 2),
            vec![
                "http://jf/dash/chunk-stream0-00043.m4s",
                "http://jf/dash/chunk-stream0-00044.m4s",
            ]
        );
    }

    #[test]
    fn returns_empty_when_no_digits_in_path() {
        assert!(predict_next_urls("http://jf/master.m3u8", 3).is_empty());
    }

    #[test]
    fn ignores_query_string_digits() {
        // The `123` in the query should not be the target — use the path digits.
        assert_eq!(
            predict_next_urls("http://jf/seg/5.mp4?t=123", 1),
            vec!["http://jf/seg/6.mp4?t=123"]
        );
    }

    #[test]
    fn classifies_m3u8_as_manifest() {
        assert!(is_manifest_url("http://jf/master.m3u8?sig=abc"));
        assert!(is_manifest_url("http://jf/dash/video.mpd"));
        assert!(!is_manifest_url("http://jf/seg/5.mp4"));
    }

    #[test]
    fn cache_inserts_and_retrieves() {
        let cache = SegmentCache::new();
        cache.insert("u".into(), Bytes::from_static(b"hello"), "video/mp4".into());
        let seg = cache.get("u").expect("hit");
        assert_eq!(&seg.body[..], b"hello");
        assert_eq!(seg.content_type, "video/mp4");
    }

    #[test]
    fn cache_evicts_when_over_cap() {
        let cache = SegmentCache::new();
        // Insert one under-cap segment, then one ~65 MB — should skip, not explode.
        cache.insert("small".into(), Bytes::from_static(b"x"), "video/mp4".into());
        assert!(cache.get("small").is_some());

        let big = vec![0u8; MAX_SEGMENT_BYTES + 1];
        cache.insert("big".into(), Bytes::from(big), "video/mp4".into());
        assert!(cache.get("big").is_none());
    }
}
