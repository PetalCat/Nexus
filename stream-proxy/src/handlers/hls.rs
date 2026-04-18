use m3u8_rs::{parse_playlist_res, Playlist};

/// Rewrite a Jellyfin HLS playlist for proxy delivery:
///
/// 1. Strip `ApiKey` / `api_key` from all URI query strings so the admin token
///    is never handed to the browser.
/// 2. Rewrite absolute and relative segment/variant URIs to go through the
///    proxy at `/stream/{session_id}/<hex-encoded-original-path>` so the
///    browser never talks to Jellyfin directly.
/// 3. Preserve all `EXT-X-STREAM-INF` attributes (bandwidth, resolution, codecs).
///
/// Returns the rewritten manifest bytes.
///
/// `manifest_url` is the FULL URL the proxy fetched this manifest from.
/// Segment and variant URIs inside the manifest may be relative (e.g.
/// `00000.ts`, `session/<id>/base/index.m3u8`); they're resolved against
/// `manifest_url` to absolute URLs before being hex-encoded, so the return
/// trip through the session handler can dispatch to the right upstream
/// even for nested manifests (master → variant → segment).
pub fn rewrite_manifest(
    raw: &[u8],
    session_id: &str,
    sig: &str,
    url_prefix: &str,
    manifest_url: &str,
) -> Result<Vec<u8>, String> {
    let parsed = parse_playlist_res(raw).map_err(|e| format!("parse: {e:?}"))?;
    match parsed {
        Playlist::MasterPlaylist(mut master) => {
            for variant in &mut master.variants {
                variant.uri = rewrite_uri(&variant.uri, session_id, sig, url_prefix, manifest_url);
            }
            for media in &mut master.alternatives {
                if let Some(uri) = media.uri.take() {
                    media.uri = Some(rewrite_uri(&uri, session_id, sig, url_prefix, manifest_url));
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
                segment.uri = rewrite_uri(&segment.uri, session_id, sig, url_prefix, manifest_url);
                if let Some(map) = &mut segment.map {
                    map.uri = rewrite_uri(&map.uri, session_id, sig, url_prefix, manifest_url);
                }
                if let Some(key) = &mut segment.key {
                    if let Some(uri) = key.uri.take() {
                        key.uri = Some(rewrite_uri(&uri, session_id, sig, url_prefix, manifest_url));
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
/// The URI is first absolutized against `manifest_url` so nested manifests
/// (master → variant → segment) resolve to the correct upstream path on the
/// return trip. Then the ApiKey stripper runs, then the absolute URL is
/// hex-encoded.
fn rewrite_uri(uri: &str, session_id: &str, sig: &str, url_prefix: &str, manifest_url: &str) -> String {
    let absolute = absolutize_uri(uri, manifest_url);
    let stripped = strip_auth_query(&absolute);
    let clean_prefix = url_prefix.trim_end_matches('/');
    format!("{clean_prefix}/{session_id}/{}?sig={sig}", hex::encode(stripped.as_bytes()))
}

/// Resolve a (possibly relative) URI against a base URL, returning an
/// absolute http(s) URL. Mirrors the logic in `session::resolve_relative`;
/// kept here to avoid a cross-module dependency.
fn absolutize_uri(uri: &str, base: &str) -> String {
    if uri.starts_with("http://") || uri.starts_with("https://") {
        return uri.to_string();
    }
    let base_no_query = base.split('?').next().unwrap_or(base);
    let origin_end = base_no_query
        .find("://")
        .and_then(|i| base_no_query[i + 3..].find('/').map(|j| i + 3 + j))
        .unwrap_or(base_no_query.len());
    let origin = &base_no_query[..origin_end];

    if uri.starts_with('/') {
        return format!("{origin}{uri}");
    }
    let dir_end = base_no_query.rfind('/').unwrap_or(base_no_query.len());
    let dir = &base_no_query[..=dir_end.min(base_no_query.len() - 1)];
    format!("{dir}{uri}")
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
        let out = rewrite_uri("/Videos/abc/hls1/main/0.ts?ApiKey=secret", "sess123", "testsig", "/stream/", "http://jf.local/Videos/abc/master.m3u8");
        assert!(out.starts_with("/stream/sess123/"));
        assert!(!out.contains("secret"), "api key must be absent");
        assert!(!out.contains("ApiKey"), "api key param name must be absent");
    }

    #[test]
    fn rewrite_uri_includes_sig_query() {
        let out = rewrite_uri("/Videos/abc/main.m3u8?ApiKey=x", "s1", "mysig", "/stream/", "http://jf.local/Videos/abc/master.m3u8");
        assert!(out.starts_with("/stream/s1/"));
        assert!(out.contains("?sig=mysig"), "sig must be embedded for router discrimination");
        assert!(!out.contains("ApiKey"));
    }

    #[test]
    fn rewrite_uri_honors_url_prefix() {
        let out = rewrite_uri("/Videos/abc/main.m3u8?ApiKey=x", "s1", "sig1", "/api/stream-proxy/", "http://jf.local/Videos/abc/master.m3u8");
        assert!(
            out.starts_with("/api/stream-proxy/s1/"),
            "expected url_prefix honored, got: {out}"
        );
        assert!(out.contains("?sig=sig1"));
        assert!(!out.contains("ApiKey"));
    }

    #[test]
    fn rewrite_master_playlist_rewrites_variants() {
        let input = b"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=640x360,CODECS=\"avc1.64001f,mp4a.40.2\"
/Videos/abc/main.m3u8?ApiKey=leaky
";
        let out = rewrite_manifest(input, "s1", "testsig", "/stream/", "http://jf.local/Videos/abc/master.m3u8").expect("parses and rewrites");
        let out_str = std::str::from_utf8(&out).unwrap();
        assert!(out_str.contains("BANDWIDTH=1280000"), "preserves bandwidth");
        assert!(out_str.contains("RESOLUTION=640x360"), "preserves resolution");
        assert!(!out_str.contains("leaky"), "strips api key");
        assert!(out_str.contains("/stream/s1/"), "rewrites URI through proxy");
        assert!(out_str.contains("?sig=testsig"), "embeds sig in rewritten URIs");
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
        let out = rewrite_manifest(input, "s1", "testsig", "/stream/", "http://jf.local/Videos/abc/master.m3u8").expect("parses and rewrites");
        let out_str = std::str::from_utf8(&out).unwrap();
        assert!(!out_str.contains("leaky"));
        assert!(out_str.contains("/stream/s1/"));
        assert!(out_str.contains("?sig=testsig"), "embeds sig in segment URIs");
        assert!(out_str.contains("#EXTINF:6"), "preserves EXTINF");
    }
}
