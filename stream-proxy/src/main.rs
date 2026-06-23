use http_body_util::combinators::BoxBody;
use hyper::body::Bytes;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use socket2::{Domain, Socket, Type};
use std::convert::Infallible;
use std::env;
use std::net::SocketAddr;
use std::sync::{Arc, LazyLock};

/// Seam↔proxy shared secret (defense-in-depth, adversarial review). Only the
/// SvelteKit seam knows NEXUS_PROXY_AUTH; every request except /healthz and CORS
/// preflight must present it, so a process that gains loopback access can't forge
/// `x-nexus-user`. Empty/unset disables the check (back-compat).
static PROXY_AUTH: LazyLock<Option<String>> =
    LazyLock::new(|| env::var("NEXUS_PROXY_AUTH").ok().filter(|s| !s.is_empty()));
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;

// ── Request handler ────────────────────────────────────────────────────────

async fn handle(
    req: Request<hyper::body::Incoming>,
    invidious_url: Arc<String>,
) -> Result<Response<BoxBody<Bytes, nexus_stream_proxy::proxy::BoxError>>, Infallible> {
    // CORS preflight (loopback-only, but the SvelteKit reverse-proxy may add it).
    if req.method() == hyper::Method::OPTIONS {
        return Ok(Response::builder()
            .status(204)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Headers", "Range, Content-Type, X-Nexus-User")
            .header("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS")
            .body(nexus_stream_proxy::proxy::empty_body())
            .unwrap());
    }

    let path = req.uri().path().to_string();
    let query = req.uri().query().unwrap_or("").to_string();
    let method = req.method().clone();

    // Health check — load-bearing for the seam trust (Node verifies the child is up).
    if path == "/healthz" {
        return Ok(Response::builder()
            .status(200)
            .header("content-type", "text/plain")
            .body(nexus_stream_proxy::proxy::full_body("ok"))
            .unwrap());
    }

    // Seam↔proxy shared-secret gate: reject anything that didn't come through the
    // SvelteKit seam (which alone holds NEXUS_PROXY_AUTH and stamps x-nexus-user),
    // so a process that gains loopback access can't forge identity.
    if let Some(expected) = PROXY_AUTH.as_ref() {
        let ok = req
            .headers()
            .get("x-nexus-proxy-auth")
            .and_then(|v| v.to_str().ok())
            == Some(expected.as_str());
        if !ok {
            return Ok(Response::builder()
                .status(403)
                .body(nexus_stream_proxy::proxy::full_body("forbidden"))
                .unwrap());
        }
    }

    // Jellyfin-style entry: POST /session (verify grant, register inline cred,
    // return grant-bearing stream URL) + GET /stream?grant=...
    if method == hyper::Method::POST && path == "/session" {
        return Ok(nexus_stream_proxy::handlers::session::create(req).await);
    }
    if method == hyper::Method::GET
        && path == "/stream"
        && query.split('&').any(|p| p.starts_with("grant="))
    {
        return Ok(nexus_stream_proxy::handlers::session::stream(req).await);
    }

    // Invidious-style entry: GET /v/{id}/...?grant=<token>
    if method == hyper::Method::GET && path.starts_with("/v/") {
        return Ok(nexus_stream_proxy::handlers::invidious::handle_v(req, invidious_url).await);
    }

    // SECURITY (adversarial review, belt-and-suspenders): the legacy
    // `invidious::handle` routes (/proxy?url=, /stats, /stream/{id}) are an
    // open-proxy SSRF + info-leak surface and are NOT used by the v2 paths
    // (/session, /stream, /v/). Nothing legitimate reaches the proxy except via
    // the seam, which allowlists only /stream and /v. Refuse anything else
    // outright so the dormant routes can't be reawakened by a future bypass.
    let _ = &invidious_url;
    Ok(Response::builder()
        .status(404)
        .body(nexus_stream_proxy::proxy::full_body("not found"))
        .unwrap())
}

#[tokio::main]
async fn main() {
    let port: u16 = env::var("STREAM_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3939);

    // Bind loopback only by default — the proxy is reached only via the
    // SvelteKit reverse-proxy on the same host (the seam). Never expose it.
    let bind_ip = env::var("STREAM_BIND").unwrap_or_else(|_| "127.0.0.1".to_string());
    let octets: Vec<u8> = bind_ip
        .split('.')
        .filter_map(|o| o.parse().ok())
        .collect();
    let ip = if octets.len() == 4 {
        [octets[0], octets[1], octets[2], octets[3]]
    } else {
        eprintln!("[stream-proxy] invalid STREAM_BIND '{bind_ip}', falling back to 127.0.0.1");
        [127, 0, 0, 1]
    };

    let invidious_url = env::var("INVIDIOUS_URL").unwrap_or_else(|_| {
        eprintln!("[stream-proxy] INVIDIOUS_URL not set, using http://localhost:3000");
        "http://localhost:3000".to_string()
    });

    let invidious_url = Arc::new(invidious_url);
    let addr = SocketAddr::from((ip, port));

    // SO_REUSEADDR so restarts don't fail while the OS holds the port in TIME_WAIT.
    let socket = Socket::new(Domain::IPV4, Type::STREAM, None).unwrap();
    socket.set_reuse_address(true).unwrap();
    socket.set_nonblocking(true).unwrap();
    socket.bind(&addr.into()).unwrap();
    socket.listen(1024).unwrap();
    let listener = TcpListener::from_std(socket.into()).unwrap();

    println!("[stream-proxy] Rust video proxy on {bind_ip}:{port} -> {invidious_url}");

    // Exit when parent Node process dies (stdin EOF).
    tokio::spawn(async {
        let mut stdin = tokio::io::stdin();
        let mut buf = [0u8; 1];
        let _ = stdin.read(&mut buf).await;
        eprintln!("[stream-proxy] Parent process gone, shutting down");
        std::process::exit(0);
    });

    loop {
        let (stream, _) = listener.accept().await.unwrap();
        let io = TokioIo::new(stream);
        let inv = invidious_url.clone();
        tokio::task::spawn(async move {
            if let Err(err) = http1::Builder::new()
                .serve_connection(io, service_fn(move |req| handle(req, inv.clone())))
                .await
            {
                if !err.is_incomplete_message() {
                    eprintln!("[stream-proxy] connection error: {err}");
                }
            }
        });
    }
}
