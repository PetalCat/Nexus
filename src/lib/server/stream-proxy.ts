import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Manages the Rust stream proxy sub-process.
 *
 * Auto-starts with Nexus, auto-restarts on crash,
 * auto-stops when the Node process exits.
 */

let proxyProcess: ChildProcess | null = null;
let restarting = false;
let restartAttempts = 0;
const PORT = 3939;
const MAX_RESTART_DELAY = 30_000;

export function startStreamProxy(invidiousUrl: string) {
	if (proxyProcess) return;

	// Find the binary
	const binaryPaths = [
		path.resolve('stream-proxy/target/release/nexus-stream-proxy'),
		path.resolve('stream-proxy/target/debug/nexus-stream-proxy'),
	];

	const binaryPath = binaryPaths.find(p => existsSync(p));
	if (!binaryPath) {
		console.warn('[stream-proxy] Rust binary not found. Run: cd stream-proxy && cargo build --release');
		return;
	}

	function launch() {
		console.log(`[stream-proxy] Starting Rust proxy on port ${PORT}`);

		proxyProcess = spawn(binaryPath!, {
			env: {
				...process.env,
				STREAM_PORT: String(PORT),
				INVIDIOUS_URL: invidiousUrl,
			},
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		proxyProcess.stdout?.on('data', (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg) {
				console.log(msg);
				if (msg.includes('Rust video proxy on port')) restartAttempts = 0;
			}
		});

		proxyProcess.stderr?.on('data', (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg) console.error(msg);
		});

		proxyProcess.on('exit', (code, signal) => {
			proxyProcess = null;
			if (!restarting) {
				const delay = Math.min(2000 * 2 ** restartAttempts, MAX_RESTART_DELAY);
				restartAttempts++;
				console.warn(`[stream-proxy] Process exited (code=${code}, signal=${signal}), restarting in ${delay / 1000}s...`);
				setTimeout(launch, delay);
			}
		});
	}

	launch();

	// Clean shutdown — use SvelteKit's shutdown event (emitted after in-flight
	// requests drain) as the primary signal, with process-level signals as a
	// fallback for dev/Vite contexts where SvelteKit's event may not fire.
	const cleanup = () => {
		restarting = true;
		if (proxyProcess) {
			proxyProcess.kill('SIGTERM');
			proxyProcess = null;
		}
	};

	// SvelteKit adapter-node guarantees this event is emitted when the server
	// is shutting down, even if there's dangling work. Safe to register async.
	process.on('sveltekit:shutdown', cleanup);

	// Belt-and-suspenders for dev: Vite doesn't emit sveltekit:shutdown.
	process.once('SIGINT', cleanup);
	process.once('SIGTERM', cleanup);
}

export function stopStreamProxy() {
	restarting = true;
	if (proxyProcess) {
		proxyProcess.kill('SIGTERM');
		proxyProcess = null;
	}
}

/**
 * Create a proxy session on the Rust stream-proxy binary. Returns a signed
 * stream URL the caller can 302-redirect the client to, or `null` if the
 * binary isn't running (caller should fall back to the Node proxy path).
 *
 * Phase 1 uses this from the Jellyfin HLS route (`/api/stream/[serviceId]/[...path]`).
 * Phase 2 will use it from the contract-aware negotiation endpoint.
 */
export async function createStreamSession(params: {
	upstreamUrl: string;
	authHeaders?: Record<string, string>;
	isHls?: boolean;
	/** Which adapter produced this session — tells the Rust proxy whether
	 *  to apply Plex-style workarounds (VOD-normalize manifests, enforce
	 *  waitForSegments=1 on each hop) or pass bytes through unchanged. */
	kind?: 'plex' | 'jellyfin' | 'generic';
}): Promise<{ streamUrl: string } | null> {
	if (!proxyProcess) return null;
	try {
		const res = await fetch(`http://127.0.0.1:${PORT}/session`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				upstream_url: params.upstreamUrl,
				auth_headers: params.authHeaders ?? {},
				is_hls: params.isHls ?? false,
				url_prefix: '/api/stream-proxy/',
				kind: params.kind ?? 'generic'
			}),
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) {
			console.warn(`[stream-proxy] /session → ${res.status}`);
			return null;
		}
		const body = (await res.json()) as { stream_url: string };
		// Rewrite the Rust-side path (/stream/...) to the Node reverse-proxy path
		// (/api/stream-proxy/...) so the browser can reach it through the Nexus origin.
		const proxyPath = body.stream_url.replace(/^\/stream\//, '/api/stream-proxy/');
		return { streamUrl: proxyPath };
	} catch (e) {
		console.warn('[stream-proxy] /session fetch error:', e);
		return null;
	}
}
