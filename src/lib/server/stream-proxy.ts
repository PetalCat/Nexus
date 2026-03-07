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
const PORT = 3939;

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
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		proxyProcess.stdout?.on('data', (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg) console.log(msg);
		});

		proxyProcess.stderr?.on('data', (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg) console.error(msg);
		});

		proxyProcess.on('exit', (code, signal) => {
			proxyProcess = null;
			if (!restarting) {
				console.warn(`[stream-proxy] Process exited (code=${code}, signal=${signal}), restarting in 2s...`);
				setTimeout(launch, 2000);
			}
		});
	}

	launch();

	// Clean shutdown
	const cleanup = () => {
		restarting = true;
		if (proxyProcess) {
			proxyProcess.kill('SIGTERM');
			proxyProcess = null;
		}
	};

	process.on('exit', cleanup);
	process.on('SIGINT', cleanup);
	process.on('SIGTERM', cleanup);
}

export function stopStreamProxy() {
	restarting = true;
	if (proxyProcess) {
		proxyProcess.kill('SIGTERM');
		proxyProcess = null;
	}
}
