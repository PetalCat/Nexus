/**
 * Jellyfin v2 adapter — LIVE integration test.
 *
 * Runs against the real seeded Jellyfin (NOT a mock). It is GUARDED: if the
 * instance env (NEXUS_JELLYFIN_URL / NEXUS_JELLYFIN_APIKEY) is absent, every
 * test is skipped so CI without the instance stays green. To run it against the
 * live instance:
 *
 *   set -a; source /home/docker/nexus-test/jellyfin.env; set +a
 *   NEXUS_JELLYFIN_URL=$JELLYFIN_URL NEXUS_JELLYFIN_APIKEY=$JELLYFIN_API_KEY \
 *     NEXUS_STREAM_SECRET=test-integration-secret-0123456789abcdef \
 *     pnpm exec vitest run src/lib/adapters/v2/__tests__/jellyfin.integration.test.ts
 *
 * Asserts: ping ok, probeServiceCredential→'ok', getLibrary returns the 2 seeded
 * movies, search('Direct') finds the h264 movie, getItem returns it, the h264
 * movie negotiates to direct-play with a valid Nexus-origin stream URL and its
 * external English subtitle is surfaced, and the hevc movie (under an h264-only
 * browser profile) negotiates to a transcode with an HLS engine + grant URL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { BrowserCaps, PlaybackPlan, PlaybackSession } from '../../playback';
import type { ServiceConfig } from '../../types';
import { jellyfinV2, __clearUserIdCache } from '../jellyfin';
import { registryV2 } from '../registry';
import { startStreamProxy, stopStreamProxy, isStreamProxyRunning } from '../../../server/stream-proxy';

const URL = process.env.NEXUS_JELLYFIN_URL ?? process.env.JELLYFIN_URL;
const API_KEY = process.env.NEXUS_JELLYFIN_APIKEY ?? process.env.JELLYFIN_API_KEY;
const HAVE_INSTANCE = !!(URL && API_KEY);

const config: ServiceConfig = {
	id: 'jellyfin',
	name: 'Jellyfin',
	type: 'jellyfin',
	url: (URL ?? '').replace(/\/+$/, ''),
	apiKey: API_KEY,
	enabled: true
};

// h264/aac → direct-plays; hevc/aac → forces transcode under a browser profile.
const DIRECT_TITLE = 'Direct Play Test (2020)';
const TRANSCODE_TITLE = 'Transcode Test (2021)';

// Honest browser profile: h264 only. The hevc movie can't direct-play here.
const BROWSER_CAPS: BrowserCaps = {
	videoCodecs: ['avc1.640028'],
	audioCodecs: ['mp4a.40.2', 'ac-3'],
	containers: ['mp4', 'ts']
};

const describeLive = HAVE_INSTANCE ? describe : describe.skip;

if (!HAVE_INSTANCE) {
	// eslint-disable-next-line no-console
	console.warn(
		'[jellyfin.integration] NEXUS_JELLYFIN_URL/APIKEY not set — skipping live integration test'
	);
}

describeLive('Jellyfin v2 adapter — live integration', () => {
	let directId = '';
	let transcodeId = '';

	beforeAll(async () => {
		__clearUserIdCache();
		// The grant mint requires the Rust proxy running with a stream secret.
		if (!process.env.NEXUS_STREAM_SECRET) {
			process.env.NEXUS_STREAM_SECRET = 'test-integration-secret-0123456789abcdef';
		}
		startStreamProxy({ invidiousUrl: 'http://localhost:3000', heldCreds: {} });
		// Give the child a moment to bind loopback.
		await new Promise((r) => setTimeout(r, 800));
	});

	afterAll(() => {
		stopStreamProxy();
	});

	it('registers conformant onto the v2 registry', () => {
		// Throws AdapterConformanceError on any hard failure.
		expect(() => registryV2.register(jellyfinV2)).not.toThrow();
		expect(registryV2.get('jellyfin')).toBeDefined();
	});

	it('ping → online', async () => {
		const health = await jellyfinV2.ping(config);
		expect(health.online).toBe(true);
	});

	it('probeServiceCredential → ok', async () => {
		const r = await jellyfinV2.probeServiceCredential!(config);
		expect(r).toBe('ok');
	});

	it('getLibrary returns the 2 seeded movies', async () => {
		const page = await jellyfinV2.getLibrary!(config, { type: 'movie', limit: 50 });
		const titles = page.items.map((i) => i.title);
		expect(titles).toContain(DIRECT_TITLE);
		expect(titles).toContain(TRANSCODE_TITLE);
		directId = page.items.find((i) => i.title === DIRECT_TITLE)!.sourceId;
		transcodeId = page.items.find((i) => i.title === TRANSCODE_TITLE)!.sourceId;
		expect(directId).toBeTruthy();
		expect(transcodeId).toBeTruthy();
	});

	it("search('Direct') finds the h264 movie", async () => {
		const r = await jellyfinV2.search!(config, 'Direct');
		expect(r.items.some((i) => i.title === DIRECT_TITLE)).toBe(true);
	});

	it('getItem returns the direct-play movie', async () => {
		const item = await jellyfinV2.getItem!(config, directId);
		expect(item).not.toBeNull();
		expect(item!.title).toBe(DIRECT_TITLE);
	});

	it('negotiatePlayback on h264 movie → direct-play + Nexus-origin URL + subtitle surfaced', async () => {
		expect(isStreamProxyRunning()).toBe(true);
		const plan: PlaybackPlan = {};
		const session: PlaybackSession = await jellyfinV2.negotiatePlayback!(
			config,
			{ id: directId, type: 'movie' },
			plan,
			BROWSER_CAPS,
			{ nexusUserId: 'test-user' }
		);

		// eslint-disable-next-line no-console
		console.log('\n[NEGOTIATE direct-play]', {
			mode: session.mode,
			engine: session.engine,
			url: session.url,
			subtitleTracks: session.subtitleTracks,
			sourceHeight: session.sourceHeight
		});

		expect(session.mode).toBe('direct-play');
		expect(session.engine).toBe('progressive');
		// Nexus-origin grant URL — never the raw Jellyfin origin, never the token.
		expect(session.url.startsWith('/api/stream-proxy/')).toBe(true);
		expect(session.url).not.toContain(config.url);
		expect(session.url.toLowerCase()).not.toContain('apikey');
		expect(session.url.toLowerCase()).not.toContain(API_KEY!.toLowerCase());

		// The external English .srt is surfaced as a side-loadable text track.
		expect(session.subtitleTracks.length).toBeGreaterThan(0);
		const eng = session.subtitleTracks.find((t) => (t.lang ?? '').startsWith('en'));
		expect(eng).toBeTruthy();
		expect(eng!.url).toContain('/api/subtitles/jellyfin');

		// End-to-end: the grant URL streams REAL bytes through the live Rust proxy.
		// (The SvelteKit reverse-proxy just forwards path+query to 127.0.0.1:3939;
		// here we hit the proxy directly with the same path the browser would.)
		const rustUrl = 'http://127.0.0.1:3939' + session.url.replace('/api/stream-proxy', '');
		const byteRes = await fetch(rustUrl, { headers: { Range: 'bytes=0-65535' } });
		// eslint-disable-next-line no-console
		console.log('[STREAM via proxy]', {
			status: byteRes.status,
			contentRange: byteRes.headers.get('content-range'),
			contentType: byteRes.headers.get('content-type')
		});
		expect([200, 206]).toContain(byteRes.status);
		const bytes = new Uint8Array(await byteRes.arrayBuffer());
		expect(bytes.length).toBeGreaterThan(1024);

		await session.close?.();
	});

	it('negotiatePlayback on hevc movie under h264 profile → transcode + HLS url', async () => {
		const session: PlaybackSession = await jellyfinV2.negotiatePlayback!(
			config,
			{ id: transcodeId, type: 'movie' },
			{},
			BROWSER_CAPS,
			{ nexusUserId: 'test-user' }
		);

		// eslint-disable-next-line no-console
		console.log('\n[NEGOTIATE transcode]', {
			mode: session.mode,
			engine: session.engine,
			url: session.url,
			sourceHeight: session.sourceHeight
		});

		expect(['transcode', 'direct-stream', 'remux']).toContain(session.mode);
		// hevc under an h264-only profile must NOT direct-play.
		expect(session.mode).not.toBe('direct-play');
		expect(session.engine).toBe('hls');
		expect(session.url.startsWith('/api/stream-proxy/')).toBe(true);
		expect(session.url.toLowerCase()).not.toContain(API_KEY!.toLowerCase());

		await session.close?.();
	});
});
