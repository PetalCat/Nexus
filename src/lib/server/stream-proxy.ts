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
