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
pub fn rewrite_manifest(raw: &[u8], session_id: &str, sig: &str) -> Result<Vec<u8>, String> {
    let parsed = parse_playlist_res(raw).map_err(|e| format!("parse: {e:?}"))?;
    match parsed {
        Playlist::MasterPlaylist(mut master) => {
            for variant in &mut master.variants {
                variant.uri = rewrite_uri(&variant.uri, session_id, sig);
            }
            for media in &mut master.alternatives {
                if let Some(uri) = media.uri.take() {
                    media.uri = Some(rewrite_uri(&uri, session_id, sig));
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
                segment.uri = rewrite_uri(&segment.uri, session_id, sig);
                if let Some(map) = &mut segment.map {
                    map.uri = rewrite_uri(&map.uri, session_id, sig);
                }
                if let Some(key) = &mut segment.key {
                    if let Some(uri) = key.uri.take() {
                        key.uri = Some(rewrite_uri(&uri, session_id, sig));
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
/// The "opaque" suffix is a hex encoding of the original URI's path+query minus
/// the stripped auth. On the return trip, the session handler decodes it and
/// forwards to the upstream with the session's real auth headers.
fn rewrite_uri(uri: &str, session_id: &str, sig: &str) -> String {
    let stripped = strip_auth_query(uri);
    format!("/stream/{session_id}/{}?sig={sig}", hex::encode(stripped.as_bytes()))
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
        let out = rewrite_uri("/Videos/abc/hls1/main/0.ts?ApiKey=secret", "sess123", "testsig");
        assert!(out.starts_with("/stream/sess123/"));
        assert!(!out.contains("secret"), "api key must be absent");
        assert!(!out.contains("ApiKey"), "api key param name must be absent");
    }

    #[test]
    fn rewrite_uri_includes_sig_query() {
        let out = rewrite_uri("/Videos/abc/main.m3u8?ApiKey=x", "s1", "mysig");
        assert!(out.starts_with("/stream/s1/"));
        assert!(out.contains("?sig=mysig"), "sig must be embedded for router discrimination");
        assert!(!out.contains("ApiKey"));
    }

    #[test]
    fn rewrite_master_playlist_rewrites_variants() {
        let input = b"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=640x360,CODECS=\"avc1.64001f,mp4a.40.2\"
/Videos/abc/main.m3u8?ApiKey=leaky
";
        let out = rewrite_manifest(input, "s1", "testsig").expect("parses and rewrites");
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
        let out = rewrite_manifest(input, "s1", "testsig").expect("parses and rewrites");
        let out_str = std::str::from_utf8(&out).unwrap();
        assert!(!out_str.contains("leaky"));
        assert!(out_str.contains("/stream/s1/"));
        assert!(out_str.contains("?sig=testsig"), "embeds sig in segment URIs");
        assert!(out_str.contains("#EXTINF:6"), "preserves EXTINF");
    }
}
