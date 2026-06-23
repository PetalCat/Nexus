use crate::session::AdapterKind;
use m3u8_rs::{parse_playlist_res, Playlist};

/// Rewrite an HLS playlist for proxy delivery:
///
/// 1. Strip `ApiKey` / `api_key` / `X-Plex-Token` (all casings) from every URI
///    query so the held service credential is never handed to the browser.
/// 2. Rewrite variant / segment / `#EXT-X-MEDIA` (audio+subs) / `#EXT-X-KEY`
///    URIs to Nexus-origin grant URLs:
///    `{url_prefix}stream?grant=<token>&suffix=<hex(absolute-upstream-url)>`.
///    The browser carries the SAME grant back on every child hop — no per-hop
///    credential, no client-named upstream URL.
/// 3. Preserve all `EXT-X-STREAM-INF` attributes; fix Jellyfin's occasional
///    bogus `BANDWIDTH=` (m3u8-rs re-serialization normalizes it).
///
/// `manifest_url` is the FULL upstream URL the proxy fetched this manifest from;
/// relative child URIs are absolutized against it before hex-encoding so the
/// return trip resolves to the right upstream even for nested manifests
/// (master → variant → segment).
pub fn rewrite_manifest(
    raw: &[u8],
    grant: &str,
    url_prefix: &str,
    manifest_url: &str,
    kind: AdapterKind,
) -> Result<Vec<u8>, String> {
    let parsed = parse_playlist_res(raw).map_err(|e| format!("parse: {e:?}"))?;
    match parsed {
        Playlist::MasterPlaylist(mut master) => {
            for variant in &mut master.variants {
                variant.uri = rewrite_uri(&variant.uri, grant, url_prefix, manifest_url);
            }
            for media in &mut master.alternatives {
                if let Some(uri) = media.uri.take() {
                    media.uri = Some(rewrite_uri(&uri, grant, url_prefix, manifest_url));
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
                segment.uri = rewrite_uri(&segment.uri, grant, url_prefix, manifest_url);
                if let Some(map) = &mut segment.map {
                    map.uri = rewrite_uri(&map.uri, grant, url_prefix, manifest_url);
                }
                if let Some(key) = &mut segment.key {
                    if let Some(uri) = key.uri.take() {
                        key.uri = Some(rewrite_uri(&uri, grant, url_prefix, manifest_url));
                    }
                }
            }
            let mut out = Vec::new();
            media
                .write_to(&mut out)
                .map_err(|e| format!("write media: {e}"))?;
            // Plex writes live-style playlists (no VERSION/PLAYLIST-TYPE/ENDLIST)
            // for what's actually VOD — HLS.js stalls at live-edge. Only normalize
            // for Plex; Jellyfin already emits proper VOD manifests.
            if kind == AdapterKind::Plex {
                out = normalize_media_playlist(out, media.media_sequence);
            }
            Ok(out)
        }
    }
}

fn normalize_media_playlist(bytes: Vec<u8>, media_sequence: u64) -> Vec<u8> {
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let has_version = text.contains("#EXT-X-VERSION");
    let has_media_sequence = text.contains("#EXT-X-MEDIA-SEQUENCE");
    let has_playlist_type = text.contains("#EXT-X-PLAYLIST-TYPE");
    let has_endlist = text.contains("#EXT-X-ENDLIST");

    let mut injects = String::new();
    if !has_version {
        injects.push_str("#EXT-X-VERSION:3\n");
    }
    if !has_media_sequence {
        injects.push_str(&format!("#EXT-X-MEDIA-SEQUENCE:{media_sequence}\n"));
    }
    if !has_playlist_type {
        injects.push_str("#EXT-X-PLAYLIST-TYPE:VOD\n");
    }

    let with_header = if injects.is_empty() {
        text
    } else if let Some(idx) = text.find("#EXTM3U") {
        let after = text[idx..].find('\n').map(|n| idx + n + 1).unwrap_or(text.len());
        let mut s = String::with_capacity(text.len() + injects.len());
        s.push_str(&text[..after]);
        s.push_str(&injects);
        s.push_str(&text[after..]);
        s
    } else {
        text
    };

    let with_endlist = if has_endlist {
        with_header
    } else {
        let mut s = with_header;
        if !s.ends_with('\n') {
            s.push('\n');
        }
        s.push_str("#EXT-X-ENDLIST\n");
        s
    };
    with_endlist.into_bytes()
}

/// Strip `ApiKey`/`api_key`, absolutize against `manifest_url`, hex-encode, and
/// emit `{prefix}stream?grant=<token>&suffix=<hex>`.
fn rewrite_uri(uri: &str, grant: &str, url_prefix: &str, manifest_url: &str) -> String {
    let absolute = absolutize_uri(uri, manifest_url);
    let stripped = strip_auth_query(&absolute);
    let clean_prefix = url_prefix.trim_end_matches('/');
    format!(
        "{clean_prefix}/stream?grant={}&suffix={}",
        urlencoding::encode(grant),
        hex::encode(stripped.as_bytes())
    )
}

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
            !name.eq_ignore_ascii_case("apikey")
                && !name.eq_ignore_ascii_case("api_key")
                && !name.eq_ignore_ascii_case("x-plex-token")
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
        assert_eq!(strip_auth_query("/segment.ts?ApiKey=abc"), "/segment.ts");
        assert_eq!(strip_auth_query("/segment.ts"), "/segment.ts");
    }

    #[test]
    fn strip_auth_removes_plex_token_casings() {
        // Plex transcode manifests embed X-Plex-Token on segment URLs; it must be
        // stripped (case-insensitive) so the held cred never reaches the browser.
        assert_eq!(
            strip_auth_query("/segment.ts?foo=1&X-Plex-Token=abc&bar=2"),
            "/segment.ts?foo=1&bar=2"
        );
        assert_eq!(
            strip_auth_query("/segment.ts?foo=1&x-plex-token=abc&bar=2"),
            "/segment.ts?foo=1&bar=2"
        );
        assert_eq!(strip_auth_query("/segment.ts?X-Plex-Token=abc"), "/segment.ts");
    }

    #[test]
    fn rewrite_uri_produces_grant_path() {
        let out = rewrite_uri(
            "/Videos/abc/hls1/main/0.ts?ApiKey=secret",
            "v4.local.TOKEN",
            "/stream/",
            "http://jf.local/Videos/abc/master.m3u8",
        );
        assert!(out.starts_with("/stream/stream?grant=v4.local.TOKEN&suffix="));
        assert!(!out.contains("secret"), "api key must be absent");
        assert!(!out.contains("ApiKey"), "api key param name must be absent");
    }

    #[test]
    fn rewrite_uri_honors_url_prefix() {
        let out = rewrite_uri(
            "/Videos/abc/main.m3u8?ApiKey=x",
            "TOK",
            "/api/stream-proxy/",
            "http://jf.local/Videos/abc/master.m3u8",
        );
        assert!(
            out.starts_with("/api/stream-proxy/stream?grant=TOK&suffix="),
            "expected url_prefix honored, got: {out}"
        );
        assert!(!out.contains("ApiKey"));
    }

    #[test]
    fn rewrite_master_playlist_rewrites_variants() {
        let input = b"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=640x360,CODECS=\"avc1.64001f,mp4a.40.2\"
/Videos/abc/main.m3u8?ApiKey=leaky
";
        let out = rewrite_manifest(
            input,
            "TOK",
            "/stream/",
            "http://jf.local/Videos/abc/master.m3u8",
            AdapterKind::Jellyfin,
        )
        .expect("parses and rewrites");
        let s = std::str::from_utf8(&out).unwrap();
        assert!(s.contains("BANDWIDTH=1280000"), "preserves bandwidth");
        assert!(s.contains("RESOLUTION=640x360"), "preserves resolution");
        assert!(!s.contains("leaky"), "strips api key");
        assert!(s.contains("grant=TOK"), "carries grant on child hop");
        assert!(s.contains("&suffix="), "hex-encodes upstream as suffix");
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
        let out = rewrite_manifest(
            input,
            "TOK",
            "/stream/",
            "http://jf.local/Videos/abc/master.m3u8",
            AdapterKind::Jellyfin,
        )
        .expect("parses and rewrites");
        let s = std::str::from_utf8(&out).unwrap();
        assert!(!s.contains("leaky"));
        assert!(s.contains("grant=TOK"));
        assert!(s.contains("#EXTINF:6"), "preserves EXTINF");
    }
}
