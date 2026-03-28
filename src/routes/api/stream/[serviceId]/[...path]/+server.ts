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

		// Codec negotiation — H.264 baseline for broadest compatibility, let Jellyfin transcode
		if (!url.searchParams.has('VideoCodec')) upstream.searchParams.set('VideoCodec', 'h264');
		if (!url.searchParams.has('AudioCodec')) upstream.searchParams.set('AudioCodec', 'aac,mp3');
		if (!url.searchParams.has('TranscodingMaxAudioChannels'))
			upstream.searchParams.set('TranscodingMaxAudioChannels', '6');
		if (!url.searchParams.has('MaxStreamingBitrate'))
			upstream.searchParams.set('MaxStreamingBitrate', '120000000');
		if (!url.searchParams.has('TranscodingProtocol'))
			upstream.searchParams.set('TranscodingProtocol', 'hls');
		if (!url.searchParams.has('TranscodingContainer'))
			upstream.searchParams.set('TranscodingContainer', 'ts');
		// Allow direct stream (remux) but not direct play (raw file) — ensures HLS wrapper
		if (!url.searchParams.has('EnableDirectStream'))
			upstream.searchParams.set('EnableDirectStream', 'true');
		if (!url.searchParams.has('EnableDirectPlay'))
			upstream.searchParams.set('EnableDirectPlay', 'false');
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

		// Jellyfin returns 500 while the transcoder is spinning up for the first segment.
		// Retry up to 2x with increasing delays before giving up.
		if (!upstream_res.ok && isSegment && upstream_res.status >= 500) {
			upstream_res = await doFetch(1500);
			if (!upstream_res.ok && upstream_res.status >= 500) {
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

			// ── Synthesize quality tiers for master.m3u8 ─────────────────
			// Jellyfin returns a single variant. We add lower-quality tiers
			// so the player can offer quality selection (720p, 480p, 360p).
			if (upstreamPath.endsWith('/master.m3u8')) {
				const streamLines = body.split('\n');
				const streamInfCount = streamLines.filter(l => l.startsWith('#EXT-X-STREAM-INF')).length;

				if (streamInfCount === 1) {
					// Find the original STREAM-INF and its main.m3u8 URL
					const infIdx = streamLines.findIndex(l => l.startsWith('#EXT-X-STREAM-INF'));
					const origInf = streamLines[infIdx];
					const origUrl = streamLines[infIdx + 1];

					// Parse source resolution and bandwidth
					const resMatch = origInf.match(/RESOLUTION=(\d+)x(\d+)/);
					const sourceWidth = resMatch ? parseInt(resMatch[1]) : 1920;
					const sourceHeight = resMatch ? parseInt(resMatch[2]) : 1080;
					const bwMatch = origInf.match(/BANDWIDTH=(\d+)/);
					const reportedBw = bwMatch ? parseInt(bwMatch[1]) : 0;

					// Jellyfin often reports bogus bandwidth for direct streams (e.g. just the audio bitrate).
					// Estimate a realistic bitrate from the resolution.
					const estimatedBitrates: Record<number, number> = {
						2160: 40_000_000,
						1080: 20_000_000,
						720: 6_000_000,
						480: 2_000_000,
						360: 1_000_000
					};
					const closestHeight = [2160, 1080, 720, 480, 360].reduce((prev, curr) =>
						Math.abs(curr - sourceHeight) < Math.abs(prev - sourceHeight) ? curr : prev
					);
					const sourceBitrate = reportedBw > 2_000_000
						? reportedBw // Use reported if it seems reasonable (>2Mbps)
						: estimatedBitrates[closestHeight] ?? 20_000_000;

					// Fix the original variant's bandwidth so hls.js sorts correctly
					streamLines[infIdx] = origInf
						.replace(/BANDWIDTH=\d+/, `BANDWIDTH=${sourceBitrate}`)
						.replace(/AVERAGE-BANDWIDTH=\d+/, `AVERAGE-BANDWIDTH=${sourceBitrate}`);

					// Extract subtitle group reference if present
					const subsMatch = origInf.match(/,SUBTITLES="([^"]+)"/);
					const subsGroup = subsMatch ? `,SUBTITLES="${subsMatch[1]}"` : '';

					// Extract codec and frame rate strings
					const codecMatch = origInf.match(/CODECS="([^"]+)"/);
					const codecs = codecMatch ? codecMatch[1] : 'avc1.640029,mp4a.40.2';
					const fpsMatch = origInf.match(/FRAME-RATE=([\d.]+)/);
					const fps = fpsMatch ? fpsMatch[1] : '23.976';

					// Quality tiers: only add tiers below source resolution
					const tiers = [
						{ height: 2160, width: 3840, bitrate: 40_000_000 },
						{ height: 1080, width: 1920, bitrate: 10_000_000 },
						{ height: 720,  width: 1280, bitrate: 4_000_000 },
						{ height: 480,  width: 854,  bitrate: 1_500_000 },
						{ height: 360,  width: 640,  bitrate: 800_000 },
					].filter(t => t.height < sourceHeight);

					// Build synthetic variants — each points to main.m3u8 with a different MaxStreamingBitrate
					const extraVariants: string[] = [];
					for (const tier of tiers) {
						const tierUrl = origUrl.replace(
							/MaxStreamingBitrate=\d+/,
							`MaxStreamingBitrate=${tier.bitrate}`
						);
						extraVariants.push(
							`#EXT-X-STREAM-INF:BANDWIDTH=${tier.bitrate},AVERAGE-BANDWIDTH=${tier.bitrate},VIDEO-RANGE=SDR,CODECS="${codecs}",RESOLUTION=${tier.width}x${tier.height},FRAME-RATE=${fps}${subsGroup}`,
							tierUrl
						);
					}

					if (extraVariants.length > 0) {
						streamLines.splice(infIdx + 2, 0, ...extraVariants);
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
