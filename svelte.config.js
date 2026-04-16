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
				'script-src': ['self', 'unsafe-inline'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:', 'http:', 'https:'],
				'font-src': ['self', 'data:'],
				'media-src': ['self', 'blob:'],
				'connect-src': ['self', 'ws:'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
