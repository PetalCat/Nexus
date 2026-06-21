/**
 * Invidious v2 adapter — Nexus-as-identity, grant-gated playback.
 *
 * Rebuilt from the v1 adapter for the v2 contract. What changed and WHY:
 *  - The v1 SID/HMAC per-user account model is GONE. Invidious content is public;
 *    Nexus owns identity. The adapter consumes ONE service config (the instance
 *    URL) and never sees a backend user credential. Subscriptions / watch history
 *    are Nexus-native modules, not the adapter's concern.
 *  - `local=true` is MANDATORY on every upstream. YouTube's googlevideo URLs are
 *    IP-locked to the Invidious instance's egress; the browser can't fetch them
 *    directly. `local=true` makes Invidious proxy the bytes, so the only origin
 *    the proxy ever talks to is the instance. (Also the privacy posture: the
 *    browser never touches Google.)
 *  - Playback rides the SAME PASETO grant + held-cred proxy spine as Jellyfin:
 *    the adapter resolves the playable instance URL server-side, registers it via
 *    createStreamSession, and hands the browser a credential-free, session-bound
 *    `/api/stream-proxy/...` URL. Copy-paste / replay / expiry defenses are
 *    inherited unchanged.
 *
 * SCOPE (Phase-0, this build): progressive (muxed itag) is fully wired + proven
 * end-to-end. DASH-adaptive is the higher-fidelity path but on a companion-backed
 * instance the DASH manifest 302s to an internal `inv-companion` host the proxy
 * can't reach from outside the Docker network — see negotiatePlayback's DASH note.
 * The level math is ported so the quality menu is honest about what the source has.
 */
import type { ServiceConfig, ServiceHealth } from '../types';
import type { PlaybackPlan, PlaybackSession, BrowserCaps, SessionLevel, TrackInfo } from '../playback';
import type { CredentialProbeResult, NexusAdapter } from './contract';
import { declareAdapter } from './contract';
import { createStreamSession, mintStreamGrant } from '../../server/stream-proxy';

const baseUrl = (c: ServiceConfig) => c.url.replace(/\/+$/, '');

// ── ported playback math (earns its port: post-SABR DASH parsing is hard-won) ──

/** Muxed (video+audio in one stream) itags, best→worst. 22=720p, 18=360p. */
const PREFERRED_MUXED_ITAGS = ['22', '18'];

interface InvFormat {
	itag?: string;
	type?: string;
	mimeType?: string;
	container?: string;
	qualityLabel?: string;
	resolution?: string;
	height?: number;
	bitrate?: string | number;
	url?: string;
}

/** Pick the best muxed mp4 stream under plan.targetHeight (or highest). */
function pickBestMuxed(formatStreams: InvFormat[], plan: PlaybackPlan): InvFormat | null {
	const muxed = formatStreams
		.filter((f) => (f.container === 'mp4' || /mp4/.test(String(f.type ?? f.mimeType ?? ''))) && f.url)
		.map((f) => ({ ...f, height: parseInt(String(f.qualityLabel ?? f.resolution ?? '0')) || 0 }));
	if (!muxed.length) return null;

	const cap = plan.targetHeight ?? Infinity;
	const eligible = muxed.filter((f) => f.height <= cap);
	const pool = eligible.length ? eligible : muxed.slice().sort((a, b) => a.height - b.height).slice(0, 1);
	pool.sort((a, b) => b.height - a.height);
	for (const itag of PREFERRED_MUXED_ITAGS) {
		const match = pool.find((f) => f.itag === itag);
		if (match) return match;
	}
	return pool[0] ?? null;
}

/** One level per unique video height from adaptiveFormats, highest first.
 *  Informational for the quality menu — progressive switching re-negotiates a
 *  different muxed itag (limited) rather than DASH level-switching. */
function extractLevels(adaptiveFormats: InvFormat[]): SessionLevel[] {
	const byHeight = new Map<number, number>();
	for (const f of adaptiveFormats) {
		if (!/^video\//.test(String(f.type ?? f.mimeType ?? ''))) continue;
		const height = parseInt(String(f.qualityLabel ?? f.resolution ?? '0'));
		if (!isFinite(height) || height <= 0) continue;
		const bitrate = parseInt(String(f.bitrate ?? 0)) || 0;
		if (!byHeight.has(height) || bitrate > (byHeight.get(height) as number)) byHeight.set(height, bitrate);
	}
	return [...byHeight.entries()]
		.map(([height, bitrate]) => ({ height, bitrate }))
		.sort((a, b) => b.height - a.height)
		.map((lvl, index) => ({ index, ...lvl }));
}

// ── negotiate ────────────────────────────────────────────────────────────────

async function negotiatePlayback(
	config: ServiceConfig,
	item: { id: string; type: string; title?: string },
	plan: PlaybackPlan,
	caps: BrowserCaps,
	ctx?: { nexusUserId?: string }
): Promise<PlaybackSession> {
	const base = baseUrl(config);
	const videoId = item.id;

	// local=true ⇒ instance-relative `/videoplayback?...` URLs the proxy can fetch.
	const res = await fetch(
		`${base}/api/v1/videos/${encodeURIComponent(videoId)}?local=true&fields=formatStreams,adaptiveFormats,captions,lengthSeconds,title`,
		{ signal: AbortSignal.timeout(10_000) }
	);
	if (!res.ok) throw new Error(`Invidious /api/v1/videos failed: ${res.status}`);
	const meta = await res.json();

	const formatStreams: InvFormat[] = meta.formatStreams ?? [];
	const adaptiveFormats: InvFormat[] = meta.adaptiveFormats ?? [];

	// Captions (shared by both engines): each WebVTT track routed through its own
	// grant-proxied session so the browser only ever talks to Nexus.
	const captionsRaw: { label?: string; languageCode?: string; url?: string }[] = meta.captions ?? [];
	const subtitleTracks: TrackInfo[] = (
		await Promise.all(
			captionsRaw.map(async (c, i): Promise<TrackInfo | null> => {
				const label = c.label ?? c.languageCode ?? `Caption ${i}`;
				const capUrl = c.url
					? c.url.startsWith('http') ? c.url : `${base}${c.url}`
					: `${base}/api/v1/captions/${encodeURIComponent(videoId)}?label=${encodeURIComponent(label)}`;
				const capProxy = await createStreamSession({
					upstreamUrl: capUrl,
					authHeaders: {},
					isHls: false,
					kind: 'generic',
					userId: ctx?.nexusUserId
				});
				if (!capProxy) return null;
				return { id: i, name: label, lang: c.languageCode ?? '', url: capProxy.streamUrl, isExternal: true };
			})
		)
	).filter((t): t is TrackInfo => t !== null);

	const levels = extractLevels(adaptiveFormats);
	const userId = ctx?.nexusUserId ?? 'legacy';

	// PREFER DASH (adaptive, up to 4K) when the video exposes adaptiveFormats.
	// Mint a grant for the DASH entry; the Rust proxy fetches + rewrites the MPD
	// on demand so every segment routes back through the grant (the browser never
	// touches the instance or googlevideo). Same user-bound copy-paste defense.
	if (adaptiveFormats.length > 0) {
		const token = mintStreamGrant({
			backend: 'invidious',
			resource_ref: videoId,
			allowed_hops: 'invidious-dash',
			// Generous TTL (decision 2): grant covers the whole watch; the player's
			// reactive recovery re-negotiates if it ever expires mid-stream.
			exp: Math.floor(Date.now() / 1000) + 6 * 60 * 60,
			user_id: userId,
			gen: 0
		});
		const dashUrl = `/api/stream-proxy/v/${encodeURIComponent(videoId)}/dash?grant=${encodeURIComponent(token)}`;
		const session: PlaybackSession = {
			engine: 'dash',
			url: dashUrl,
			mime: 'application/dash+xml',
			mode: 'direct-play',
			audioTracks: [{ id: 0, name: 'Default', lang: '' }],
			subtitleTracks,
			burnableSubtitleTracks: [],
			levels: levels.length ? levels : undefined,
			sourceHeight: levels[0]?.height
		};
		// dash.js does its own ABR; re-negotiate only re-issues the grant.
		session.changeQuality = async (newPlan: PlaybackPlan) =>
			negotiatePlayback(config, item, { ...plan, ...newPlan }, caps, ctx);
		return session;
	}

	// PROGRESSIVE fallback (muxed itag) — for videos with no adaptiveFormats.
	const picked = pickBestMuxed(formatStreams, plan);
	if (!picked?.url) {
		throw new Error('Invidious: no DASH adaptiveFormats and no progressive muxed stream available for this video');
	}
	const upstreamUrl = picked.url.startsWith('http') ? picked.url : `${base}${picked.url}`;
	const proxy = await createStreamSession({
		upstreamUrl,
		authHeaders: {},
		isHls: false,
		kind: 'generic',
		userId: ctx?.nexusUserId
	});
	// FAIL CLOSED — never hand back the raw instance /videoplayback URL.
	if (!proxy) {
		throw new Error('stream proxy handoff failed (fail-closed: refusing to expose the raw instance URL)');
	}

	const session: PlaybackSession = {
		engine: 'progressive',
		url: proxy.streamUrl,
		mime: 'video/mp4',
		mode: 'direct-play',
		audioTracks: [{ id: 0, name: 'Default', lang: '' }],
		subtitleTracks,
		burnableSubtitleTracks: [],
		levels: levels.length ? levels : undefined,
		sourceHeight: picked.height || (levels[0]?.height ?? undefined)
	};
	session.changeQuality = async (newPlan: PlaybackPlan) =>
		negotiatePlayback(config, item, { ...plan, ...newPlan }, caps, ctx);
	return session;
}

// ── the adapter ────────────────────────────────────────────────────────────

export const invidiousV2 = declareAdapter({
	id: 'invidious',
	displayName: 'Invidious',
	defaultPort: 3000,
	abbreviation: 'IV',
	color: '#b31217',
	icon: 'invidious',
	contractVersion: 2,
	tier: 'media-source',
	capabilities: {
		media: ['video'],
		// Anonymous reads: Invidious content is public, so serviceAuth.required=false.
		// The single config field is the instance URL.
		serviceAuth: { required: false, fields: ['url'], kind: 'none' },
		playback: true
	},

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			const res = await fetch(`${baseUrl(config)}/api/v1/stats`, { signal: AbortSignal.timeout(5000) });
			if (!res.ok) throw new Error(`/api/v1/stats → ${res.status}`);
			return { serviceId: config.id, name: config.name, type: 'invidious', online: true, latency: Date.now() - start };
		} catch (e) {
			return { serviceId: config.id, name: config.name, type: 'invidious', online: false, error: String(e) };
		}
	},

	/** No service credential to validate (anonymous) — reachability is the probe. */
	async probeServiceCredential(config): Promise<CredentialProbeResult> {
		try {
			const res = await fetch(`${baseUrl(config)}/api/v1/stats`, { signal: AbortSignal.timeout(5000) });
			return res.ok ? 'ok' : 'invalid';
		} catch {
			return 'invalid';
		}
	},

	async negotiatePlayback(config, item, plan, caps, ctx): Promise<PlaybackSession> {
		return negotiatePlayback(config, item, plan, caps, ctx);
	}
});
