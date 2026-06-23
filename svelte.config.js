import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Self-hosted on arbitrary host:port — users reach Nexus via LAN IP,
		// reverse proxies, Tailscale, etc. SvelteKit's strict Origin check
		// would 403 every form POST unless ORIGIN env var matches exactly.
		// Matches Jellyfin/Sonarr/Radarr behavior.
		csrf: { checkOrigin: false },
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				// 'wasm-unsafe-eval' lets the browser compile/instantiate WebAssembly
				// (the nucleo search matcher) WITHOUT allowing general 'unsafe-eval' —
				// the narrow, modern directive. Without it the wasm CompileError-s and
				// search silently falls back to unranked order.
				'script-src': [
					'self',
					'unsafe-inline',
					'wasm-unsafe-eval',
					'blob:',
					'https://static.cloudflareinsights.com'
				],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:', 'http:', 'https:'],
				'font-src': ['self', 'data:'],
				'media-src': ['self', 'blob:'],
				'connect-src': ['self', 'ws:', 'wss:', 'https://cloudflareinsights.com'],
				'worker-src': ['self', 'blob:'],
				'frame-src': ['self', 'blob:'],
				'child-src': ['self', 'blob:'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
