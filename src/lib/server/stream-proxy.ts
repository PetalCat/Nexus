import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { deriveStreamPaserkKey, mintGrant, type StreamGrant } from '$lib/server/stream-grant';

/**
 * Supervisor for the Rust stream byte-proxy (Phase-0 STREAM CORE).
 *
 * Responsibilities:
 *  - spawn / restart-with-backoff / shutdown-cleanup the loopback-only Rust child
 *  - inject the PASETO v4.local key (PASERK k4.local, current + previous for
 *    two-key rotation) into the child env — derived here, NEVER re-derived in Rust
 *  - inject the per-backend HELD service-cred table (base URL + auth header) into
 *    the child env; the proxy holds these server-side so no credential ever rides
 *    in a token, URL, manifest, or response
 *
 * The grant token the browser sees carries no secrets — only a sealed grant the
 * Rust proxy verifies while holding the real cred. See `stream-grant.ts`.
 */

let proxyProcess: ChildProcess | null = null;
let restarting = false;
let restartAttempts = 0;
const PORT = 3939;
const HOST = '127.0.0.1';
const MAX_RESTART_DELAY = 30_000;

/** A backend's held service credential — base URL + the auth header the proxy
 *  injects upstream. The browser never sees any of this. */
export interface HeldCred {
	/** Upstream origin/base the proxy resolves resource_ref / hop suffixes against. */
	base_url: string;
	/** Header name to inject upstream (e.g. "Authorization", "X-Emby-Token"). */
	auth_header_name: string;
	/** Header value (the actual service credential). */
	auth_header_value: string;
}

export type HeldCredTable = Record<string, HeldCred>;

/** Module-level config captured at start so `mintStreamGrant` can sign without
 *  re-reading env / re-deriving the key on every call. */
let currentPaserkKey: string | null = null;
const KID_CURRENT = 'k0';

export interface StartStreamProxyOptions {
	/** Legacy Invidious instance URL (kept for the Invidious entry routes). */
	invidiousUrl: string;
	/** Per-backend held service-cred table. Injected into the Rust child env. */
	heldCreds?: HeldCredTable;
	/** Raw dedicated stream secret. HKDF-derived to the PASERK k4.local key.
	 *  Falls back to env NEXUS_STREAM_SECRET. */
	streamSecret?: string;
	/** Optional previous secret for two-key rotation (current+previous). */
	previousStreamSecret?: string;
}

/**
 * Start the Rust stream proxy. Derives + injects the PASETO key and held-cred
 * table; binds loopback only. Idempotent.
 */
export function startStreamProxy(opts: StartStreamProxyOptions): void {
	if (proxyProcess) return;

	const binaryPaths = [
		path.resolve('stream-proxy/target/release/nexus-stream-proxy'),
		path.resolve('stream-proxy/target/debug/nexus-stream-proxy'),
	];
	const binaryPath = binaryPaths.find((p) => existsSync(p));
	if (!binaryPath) {
		console.warn(
			'[stream-proxy] Rust binary not found. Run: cd stream-proxy && cargo build --release'
		);
		return;
	}

	const secret = opts.streamSecret ?? process.env.NEXUS_STREAM_SECRET;
	if (!secret) {
		console.warn(
			'[stream-proxy] NEXUS_STREAM_SECRET not set — refusing to start (grant signing key would be undefined)'
		);
		return;
	}

	// Derive the current PASETO key once. Rust receives the PASERK string and
	// parses it directly — it never re-derives.
	const paserkCurrent = deriveStreamPaserkKey(secret);
	currentPaserkKey = paserkCurrent;
	const paserkPrevious = opts.previousStreamSecret
		? deriveStreamPaserkKey(opts.previousStreamSecret)
		: undefined;

	const heldCredsJson = JSON.stringify(opts.heldCreds ?? {});

	function launch() {
		console.log(`[stream-proxy] Starting Rust proxy on ${HOST}:${PORT}`);

		proxyProcess = spawn(binaryPath!, {
			env: {
				...process.env,
				STREAM_PORT: String(PORT),
				STREAM_BIND: HOST,
				INVIDIOUS_URL: opts.invidiousUrl,
				// PASERK k4.local key(s). Current is mandatory; previous enables
				// zero-downtime rotation (verify tries current then previous).
				NEXUS_STREAM_PASETO_KEY: paserkCurrent,
				...(paserkPrevious ? { NEXUS_STREAM_PASETO_KEY_PREVIOUS: paserkPrevious } : {}),
				// Per-backend held service creds. JSON: { backend: { base_url,
				// auth_header_name, auth_header_value } }.
				NEXUS_STREAM_HELD_CREDS: heldCredsJson,
			},
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		proxyProcess.stdout?.on('data', (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg) {
				console.log(msg);
				if (msg.includes('Rust video proxy on')) restartAttempts = 0;
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
				console.warn(
					`[stream-proxy] Process exited (code=${code}, signal=${signal}), restarting in ${delay / 1000}s...`
				);
				setTimeout(launch, delay);
			}
		});
	}

	launch();

	const cleanup = () => {
		restarting = true;
		if (proxyProcess) {
			proxyProcess.kill('SIGTERM');
			proxyProcess = null;
		}
	};
	process.on('sveltekit:shutdown', cleanup);
	process.once('SIGINT', cleanup);
	process.once('SIGTERM', cleanup);
}

export function stopStreamProxy(): void {
	restarting = true;
	if (proxyProcess) {
		proxyProcess.kill('SIGTERM');
		proxyProcess = null;
	}
	currentPaserkKey = null;
}

/**
 * Mint a grant token for a stream, using the key the supervisor derived at
 * start. Returns the PASETO v4.local token (carries no credential). Callers
 * embed it as `?grant=<token>` (Invidious) or in the `/session` body (Jellyfin).
 *
 * Throws if the proxy hasn't been started (no key) — fail closed rather than
 * mint with an undefined key.
 */
export function mintStreamGrant(grant: StreamGrant): string {
	if (!currentPaserkKey) {
		throw new Error('[stream-proxy] cannot mint grant: proxy not started / no PASETO key');
	}
	return mintGrant(grant, currentPaserkKey, KID_CURRENT);
}

/** Whether the proxy child is currently running. */
export function isStreamProxyRunning(): boolean {
	return proxyProcess !== null;
}

/**
 * BACK-COMPAT bridge for the existing Jellyfin/Plex playback handoff, which
 * still passes an upstream URL + auth headers inline (the pre-grant adapter
 * shape). It mints a grant and posts to the Rust `/session` endpoint, which
 * holds the inline cred server-side and hands the browser a credential-free
 * grant URL. The full adapter migration to backend-resolved held creds happens
 * in the adapter-build phase; this keeps Phase-0 wiring intact.
 *
 * Returns `{ streamUrl }` (a Nexus-origin `/api/stream-proxy/...` URL) or
 * `null` if the proxy isn't running (caller falls back to the Node pipe).
 */
export async function createStreamSession(params: {
	upstreamUrl: string;
	authHeaders?: Record<string, string>;
	isHls?: boolean;
	kind?: 'plex' | 'jellyfin' | 'generic';
	userId?: string;
	gen?: number;
}): Promise<{ streamUrl: string } | null> {
	if (!proxyProcess || !currentPaserkKey) return null;
	try {
		const userId = params.userId ?? 'legacy';
		const gen = params.gen ?? 0;
		// Mint a grant bound to a synthetic "inline" backend. The proxy reads the
		// inline cred from the session body but only after verifying this grant.
		const grant = mintStreamGrant({
			backend: 'inline',
			resource_ref: params.upstreamUrl,
			allowed_hops: 'inline',
			exp: Math.floor(Date.now() / 1000) + 6 * 60 * 60,
			user_id: userId,
			gen,
		});
		const res = await fetch(`http://${HOST}:${PORT}/session`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				grant,
				// the user the grant was minted for, so the /session registration
				// verifies with the same identity the browser seam will stamp.
				user_id: userId,
				upstream_url: params.upstreamUrl,
				auth_headers: params.authHeaders ?? {},
				is_hls: params.isHls ?? false,
				url_prefix: '/api/stream-proxy/',
				kind: params.kind ?? 'generic',
			}),
			// Loopback handoff to the Rust proxy. 5s was too tight under burst:
			// a 4K load test at 40 simultaneous negotiates tripped it (the POSTs
			// queue behind PlaybackInfo + the single-thread dev server, and the
			// timeout counts queue time). 15s gives the tail room to complete
			// without ever falling back (which fails closed anyway).
			signal: AbortSignal.timeout(15000),
		});
		if (!res.ok) {
			console.warn(`[stream-proxy] /session → ${res.status}`);
			return null;
		}
		const body = (await res.json()) as { stream_url: string };
		// The proxy returns a root-relative URL on its own origin (e.g.
		// `/stream?grant=…` for the v2 grant shape, or `/stream/…` legacy). Re-anchor
		// it under the SvelteKit reverse-proxy seam so the browser hits
		// `/api/stream-proxy/stream?grant=…`. Prefix-only — preserves the query
		// string (where the grant lives) verbatim.
		const rel = body.stream_url.startsWith('/') ? body.stream_url : `/${body.stream_url}`;
		const proxyPath = `/api/stream-proxy${rel}`;
		return { streamUrl: proxyPath };
	} catch (e) {
		console.warn('[stream-proxy] /session fetch error:', e);
		return null;
	}
}
