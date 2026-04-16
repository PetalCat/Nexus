use http_body_util::combinators::BoxBody;
use hyper::body::Bytes;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use socket2::{Domain, Socket, Type};
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;

type BoxError = Box<dyn std::error::Error + Send + Sync>;

// ── Request handler ────────────────────────────────────────────────────────

async fn handle(
    req: Request<hyper::body::Incoming>,
    invidious_url: Arc<String>,
) -> Result<Response<BoxBody<Bytes, BoxError>>, Infallible> {
    // CORS preflight
    if req.method() == hyper::Method::OPTIONS {
        return Ok(Response::builder()
            .status(204)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Headers", "Range, Content-Type")
            .header("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS")
            .body(nexus_stream_proxy::proxy::empty_body())
            .unwrap());
    }

    let path = req.uri().path().to_string();
    let query = req.uri().query().unwrap_or("").to_string();
    let method = req.method().clone();

    // New session-based routes
    if method == hyper::Method::POST && path == "/session" {
        return Ok(nexus_stream_proxy::handlers::session::create(req).await);
    }
    if method == hyper::Method::GET
        && path.starts_with("/stream/")
        && query.split('&').any(|p| p.starts_with("sig="))
    {
        return Ok(nexus_stream_proxy::handlers::session::stream(req).await);
    }

    // Legacy Invidious-specific routes (/stats, /proxy?url=..., legacy /stream/...)
    Ok(nexus_stream_proxy::handlers::invidious::handle(req, invidious_url).await)
}

#[tokio::main]
async fn main() {
    let port: u16 = env::var("STREAM_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3939);

    let invidious_url = env::var("INVIDIOUS_URL").unwrap_or_else(|_| {
        eprintln!("[stream-proxy] INVIDIOUS_URL not set, using http://localhost:3000");
        "http://localhost:3000".to_string()
    });

    let invidious_url = Arc::new(invidious_url);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    // Use socket2 to set SO_REUSEADDR before binding, so restarts don't fail
    // with "Address already in use" while the OS holds the port in TIME_WAIT.
    let socket = Socket::new(Domain::IPV4, Type::STREAM, None).unwrap();
    socket.set_reuse_address(true).unwrap();
    socket.set_nonblocking(true).unwrap();
    socket.bind(&addr.into()).unwrap();
    socket.listen(1024).unwrap();
    let listener = TcpListener::from_std(socket.into()).unwrap();

    println!("[stream-proxy] Rust video proxy on port {port} -> {invidious_url}");

    // Exit when parent Node process dies (stdin EOF).
    tokio::spawn(async {
        let mut stdin = tokio::io::stdin();
        let mut buf = [0u8; 1];
        // read blocks until EOF (parent closed pipe / exited)
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
