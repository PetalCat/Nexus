import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { RequestHandler } from './$types';

/** Cache resolved Jellyfin userIds per service to avoid extra lookups on every segment request */
const userIdCache = new Map<string, string>();

/**
 * Stream proxy — keeps Jellyfin API keys server-side and makes playback
 * feel native to Nexus.  The catch-all `[...path]` handles every sub-request
 * that hls.js / the browser makes (master.m3u8, main.m3u8, segments, subtitles, etc.).
 *
 * URL patterns:
 *   /api/stream/{serviceId}/{itemId}/master.m3u8   → HLS adaptive playlist
 *   /api/stream/{serviceId}/{itemId}/main.m3u8     → HLS variant playlist
 *   /api/stream/{serviceId}/{itemId}/*.ts           → HLS segments
 *   /api/stream/{serviceId}/{itemId}/stream         → Direct progressive stream
 *   /api/stream/{serviceId}/{itemId}/stream.mp4     → Direct MP4 stream
 *   /api/stream/{serviceId}/audio/{itemId}/universal → Audio universal endpoint
 *   /api/stream/{serviceId}/{itemId}/Subtitles/...  → Subtitle streams
 */
export const GET: RequestHandler = async ({ params, url, request, locals }) => {
	// Auth gate
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const { serviceId } = params;
	const pathSegments = params.path; // e.g. "abc123/master.m3u8"

	if (!pathSegments) return new Response('Missing path', { status: 400 });

	const config = getServiceConfig(serviceId);
	if (!config) return new Response('Service not found', { status: 404 });


	const adapter = registry.get(config.type);

	// Resolve per-user credential if the adapter supports it
	const userCred =
		locals.user?.id && adapter?.userLinkable
			? getUserCredentialForService(locals.user.id, serviceId) ?? undefined
			: undefined;

	const token = userCred?.accessToken ?? config.apiKey ?? '';

	// Resolve Jellyfin userId for endpoints that need it
	let jellyfinUserId = userCred?.externalUserId ?? '';
	if (!jellyfinUserId) {
		const cached = userIdCache.get(serviceId);
		if (cached) {
			jellyfinUserId = cached;
		} else if (token) {
			// Prefer resolving via the same token used for playback so we keep user context.
			try {
				const meRes = await fetch(`${config.url}/Users/Me`, {
					headers: {
						Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-${config.id}", Version="1.0.0", Token="${token}"`,
						'X-Emby-Token': token
					},
					signal: AbortSignal.timeout(5000)
				});
				if (meRes.ok) {
					const me = await meRes.json();
					jellyfinUserId = me.Id ?? '';
				}
			} catch { /* silent */ }
		}

		if (!jellyfinUserId && config.apiKey) {
			// Last resort for server API key setups with no per-user token.
			if (!jellyfinUserId) {
				try {
					const usersRes = await fetch(`${config.url}/Users`, {
						headers: { 'X-Emby-Token': config.apiKey },
						signal: AbortSignal.timeout(5000)
					});
					if (usersRes.ok) {
						const users = await usersRes.json();
						const list = Array.isArray(users) ? users : (users.Items ?? []);
						const admin = list.find((u: any) => u.Policy?.IsAdministrator);
						jellyfinUserId = (admin ?? list[0])?.Id ?? '';
					}
				} catch { /* silent */ }
			}

			if (jellyfinUserId) userIdCache.set(serviceId, jellyfinUserId);
		}
	}

	// ── Build the upstream Jellyfin URL ──────────────────────────────────
	const parts = pathSegments.split('/');
	let upstreamPath: string;

	if (parts[0] === 'audio' && parts.length >= 2) {
		// /api/stream/{svc}/audio/{itemId}/universal
		const itemId = parts[1];
		const rest = parts.slice(2).join('/') || 'universal';
		upstreamPath = `/Audio/${itemId}/${rest}`;
	} else {
		// Everything else → /Videos/{itemId}/{rest}
		const itemId = parts[0];
		const rest = parts.slice(1).join('/') || 'stream';
		upstreamPath = `/Videos/${itemId}/${rest}`;
	}

	const upstream = new URL(`${config.url}${upstreamPath}`);

	// Forward client query-params (hls.js appends session tokens etc.)
	for (const [k, v] of url.searchParams) {
		upstream.searchParams.set(k, v);
	}

	// Inject defaults for the HLS master playlist request
	if (upstreamPath.endsWith('/master.m3u8') && !url.searchParams.has('MediaSourceId')) {
		const itemId = parts[0];
		upstream.searchParams.set('MediaSourceId', itemId);
		if (jellyfinUserId) upstream.searchParams.set('UserId', jellyfinUserId);
		upstream.searchParams.set('DeviceId', `nexus-${config.id}`);
		upstream.searchParams.set('PlaySessionId', `nexus-${Date.now()}`);

		// Codec negotiation — only list codecs the browser can actually decode.
		// AC3/EAC3/DTS must be transcoded; listing them as "playable" causes
		// Jellyfin to direct-stream them into HLS and the browser renders silence.
		if (!url.searchParams.has('VideoCodec')) upstream.searchParams.set('VideoCodec', 'h264,h265,hevc,av1');
		if (!url.searchParams.has('AudioCodec')) upstream.searchParams.set('AudioCodec', 'aac,mp3,opus');
		if (!url.searchParams.has('TranscodingMaxAudioChannels'))
			upstream.searchParams.set('TranscodingMaxAudioChannels', '2');
		const serverMaxBitrate = 120_000_000;
		const clientMaxBitrate = parseInt(url.searchParams.get('MaxStreamingBitrate') ?? '');
		const capped = Number.isFinite(clientMaxBitrate) && clientMaxBitrate > 0 && clientMaxBitrate < serverMaxBitrate;
		if (!url.searchParams.has('MaxStreamingBitrate'))
			upstream.searchParams.set('MaxStreamingBitrate', String(serverMaxBitrate));
		if (!url.searchParams.has('TranscodingProtocol'))
			upstream.searchParams.set('TranscodingProtocol', 'hls');
		if (!url.searchParams.has('TranscodingContainer'))
			upstream.searchParams.set('TranscodingContainer', 'ts');
		// Direct stream (remux) preferred at uncapped quality. When the client
		// picks a specific bitrate cap, disable direct play/stream AND block
		// stream-copy so Jellyfin actually re-encodes to the requested quality
		// instead of passing the original bitstream through unchanged.
		if (!url.searchParams.has('EnableDirectStream'))
			upstream.searchParams.set('EnableDirectStream', capped ? 'false' : 'true');
		if (!url.searchParams.has('EnableDirectPlay'))
			upstream.searchParams.set('EnableDirectPlay', capped ? 'false' : 'true');
		if (capped) {
			upstream.searchParams.set('AllowVideoStreamCopy', 'false');
			upstream.searchParams.set('AllowAudioStreamCopy', 'false');
		}
		upstream.searchParams.set('BreakOnNonKeyFrames', 'true');
		// Deliver subtitles as separate HLS WebVTT tracks so the player can toggle them
		if (!url.searchParams.has('SubtitleMethod'))
			upstream.searchParams.set('SubtitleMethod', 'Hls');
		upstream.searchParams.set('SubtitleStreamIndex', url.searchParams.get('SubtitleStreamIndex') ?? '-1');
		upstream.searchParams.set('RequireNonAnamorphic', 'false');
	}

	// Inject defaults for audio universal
	if (upstreamPath.includes('/universal')) {
		if (!url.searchParams.has('Container'))
			upstream.searchParams.set('Container', 'opus,mp3|mp3,aac,m4a,m4b|aac,flac,webma,webm|webma,wav,ogg');
		if (!url.searchParams.has('TranscodingContainer'))
			upstream.searchParams.set('TranscodingContainer', 'aac');
		if (!url.searchParams.has('AudioCodec'))
			upstream.searchParams.set('AudioCodec', 'aac,opus,flac');
		if (!url.searchParams.has('MaxStreamingBitrate'))
			upstream.searchParams.set('MaxStreamingBitrate', '40000000'); // allow lossless passthrough
		if (!url.searchParams.has('EnableDirectStream'))
			upstream.searchParams.set('EnableDirectStream', 'true');
		if (!url.searchParams.has('EnableDirectPlay'))
			upstream.searchParams.set('EnableDirectPlay', 'true');
		const uid = userCred?.externalUserId ?? jellyfinUserId;
		if (uid) upstream.searchParams.set('UserId', uid);
	}

	// Inject defaults for direct video stream
	if (upstreamPath.endsWith('/stream') || upstreamPath.endsWith('/stream.mp4')) {
		if (!url.searchParams.has('static')) upstream.searchParams.set('static', 'true');
		if (!url.searchParams.has('MediaSourceId')) upstream.searchParams.set('MediaSourceId', parts[0]);
		if (jellyfinUserId) upstream.searchParams.set('UserId', jellyfinUserId);
	}

	// ── Phase 1: delegate byte delivery to the Rust stream-proxy ──────────
	//
	// Node continues to build the Jellyfin upstream URL (the negotiation logic
	// here stays the same for now — Phase 2 replaces it with the adapter
	// contract). What changes is that instead of Node fetching + piping, we
	// create a session on the Rust binary and 302-redirect the client to it.
	// The Rust binary verifies the HMAC, looks up the session, and pipes bytes
	// zero-copy from Jellyfin.
	//
	// If the Rust binary isn't running, fall through to the legacy Node path.
	{
		const { createStreamSession } = await import('$lib/server/stream-proxy');
		const isHlsManifest =
			upstreamPath.endsWith('/master.m3u8') || upstreamPath.endsWith('/main.m3u8');
		const handoff = await createStreamSession({
			upstreamUrl: upstream.toString(),
			authHeaders: {
				Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-${config.id}", Version="1.0.0", Token="${token}"`,
				'X-Emby-Token': token
			},
			isHls: isHlsManifest
		});
		if (handoff) {
			return new Response(null, {
				status: 302,
				headers: {
					Location: handoff.streamUrl,
					'Cache-Control': 'no-store'
				}
			});
		}
		// handoff was null — Rust binary not running. Fall through.
		console.warn(`[fallback-node-proxy] Rust proxy unavailable, using Node pipe for ${upstreamPath}`);
	}

	// ── Proxy the request ─────────────────────────────────────────────────

	const proxyHeaders: Record<string, string> = {
		Authorization: `MediaBrowser Client="Nexus", Device="Nexus Server", DeviceId="nexus-${config.id}", Version="1.0.0", Token="${token}"`,
		'X-Emby-Token': token
	};

	// Forward Range header for seeking
	const range = request.headers.get('Range');
	if (range) proxyHeaders['Range'] = range;

	const isSegment = upstreamPath.endsWith('.ts') || upstreamPath.endsWith('.mp4') || upstreamPath.endsWith('.m4s');

	async function doFetch(retryDelay = 0) {
		if (retryDelay > 0) await new Promise(r => setTimeout(r, retryDelay));
		return fetch(upstream.toString(), {
			headers: proxyHeaders,
			signal: AbortSignal.timeout(30_000)
		});
	}

	try {
		let upstream_res = await doFetch();

		// Jellyfin can return transient 404/5xx responses while a new transcode
		// session spins up after a quality change. Retry with backoff before failing.
		if (!upstream_res.ok && isSegment && (upstream_res.status === 404 || upstream_res.status >= 500)) {
			upstream_res = await doFetch(1500);
			if (!upstream_res.ok && (upstream_res.status === 404 || upstream_res.status >= 500)) {
				upstream_res = await doFetch(3000);
			}
		}

		if (!upstream_res.ok) {
			const errBody = await upstream_res.text().catch(() => '');
			console.error(`[stream-proxy] UPSTREAM ERROR ${upstream_res.status}: ${errBody.slice(0, 500)}`);
			return new Response(errBody || `Upstream error: ${upstream_res.status}`, {
				status: upstream_res.status,
				headers: { 'Content-Type': 'text/plain' }
			});
		}

		const contentType = upstream_res.headers.get('Content-Type') ?? 'application/octet-stream';

		// ── Rewrite m3u8 manifests ──────────────────────────────────────
		// Replace absolute Jellyfin paths with our proxy paths so the browser
		// keeps fetching through Nexus instead of hitting Jellyfin directly.
		if (contentType.includes('mpegurl') || upstreamPath.endsWith('.m3u8')) {
			let body = await upstream_res.text();

			// Absolute paths like /Videos/{id}/hls1/... → /api/stream/{serviceId}/{id}/hls1/...
			body = body.replace(
				/\/Videos\/([a-f0-9-]+)\//gi,
				`/api/stream/${serviceId}/$1/`
			);

			// Absolute audio paths
			body = body.replace(
				/\/Audio\/([a-f0-9-]+)\//gi,
				`/api/stream/${serviceId}/audio/$1/`
			);

			// Rewrite subtitle playlist URIs that may be absolute
			body = body.replace(
				/URI="\/Videos\/([a-f0-9-]+)\//gi,
				`URI="/api/stream/${serviceId}/$1/`
			);

			// ── Fix bogus bandwidth in master.m3u8 ─────────────────────
			// Jellyfin often reports unrealistically low bandwidth for direct
			// streams (e.g. just the audio bitrate). Correct it so hls.js
			// can make sensible ABR decisions.
			if (upstreamPath.endsWith('/master.m3u8')) {
				const streamLines = body.split('\n');
				const infIdx = streamLines.findIndex(l => l.startsWith('#EXT-X-STREAM-INF'));
				if (infIdx >= 0) {
					const origInf = streamLines[infIdx];
					const resMatch = origInf.match(/RESOLUTION=\d+x(\d+)/);
					const sourceHeight = resMatch ? parseInt(resMatch[1]) : 1080;
					const bwMatch = origInf.match(/BANDWIDTH=(\d+)/);
					const reportedBw = bwMatch ? parseInt(bwMatch[1]) : 0;

					if (reportedBw < 2_000_000) {
						const estimatedBitrates: Record<number, number> = {
							2160: 40_000_000, 1080: 20_000_000, 720: 6_000_000,
							480: 2_000_000, 360: 1_000_000
						};
						const closestHeight = [2160, 1080, 720, 480, 360].reduce((prev, curr) =>
							Math.abs(curr - sourceHeight) < Math.abs(prev - sourceHeight) ? curr : prev
						);
						const correctedBw = estimatedBitrates[closestHeight] ?? 20_000_000;
						streamLines[infIdx] = origInf
							.replace(/BANDWIDTH=\d+/, `BANDWIDTH=${correctedBw}`)
							.replace(/AVERAGE-BANDWIDTH=\d+/, `AVERAGE-BANDWIDTH=${correctedBw}`);
						body = streamLines.join('\n');
					}
				}
			}

			return new Response(body, {
				status: 200,
				headers: {
					'Content-Type': 'application/vnd.apple.mpegurl',
					'Cache-Control': 'no-cache'
				}
			});
		}

		// ── Rewrite WebVTT subtitle files that reference segment URIs ───
		if (contentType.includes('text/vtt') || upstreamPath.endsWith('.vtt')) {
			let body = await upstream_res.text();
			body = body.replace(
				/\/Videos\/([a-f0-9-]+)\//gi,
				`/api/stream/${serviceId}/$1/`
			);
			return new Response(body, {
				status: 200,
				headers: { 'Content-Type': 'text/vtt', 'Cache-Control': 'no-cache' }
			});
		}

		// ── Pass-through for segments, streams, subtitles ───────────────
		const responseHeaders: Record<string, string> = {
			'Content-Type': contentType
		};

		// Preserve headers essential for range requests / seeking
		for (const h of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Disposition']) {
			const v = upstream_res.headers.get(h);
			if (v) responseHeaders[h] = v;
		}

		return new Response(upstream_res.body, {
			status: upstream_res.status,
			headers: responseHeaders
		});
	} catch (e) {
		console.error('[stream-proxy] fetch error', e);
		return new Response('Stream proxy error', { status: 502 });
	}
};
