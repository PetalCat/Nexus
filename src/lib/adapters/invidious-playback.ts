import type { ServiceConfig, UserCredential } from './types';
import type { PlaybackPlan, PlaybackSession, BrowserCaps, SessionLevel } from './playback';

/** Extract quality levels from Invidious's adaptiveFormats — one level per
 *  unique video height. Sorted descending (highest quality first). */
export function extractLevels(adaptiveFormats: any[]): SessionLevel[] {
	const videoFormats = adaptiveFormats.filter((f) => {
		const mime = String(f.type ?? f.mimeType ?? '');
		return mime.startsWith('video/') && (f.qualityLabel || f.resolution);
	});

	const byHeight = new Map<number, { bitrate: number }>();
	for (const f of videoFormats) {
		const heightStr = String(f.qualityLabel ?? f.resolution ?? '');
		const height = parseInt(heightStr);
		if (!isFinite(height) || height <= 0) continue;
		const bitrate = parseInt(String(f.bitrate ?? 0)) || 0;
		const existing = byHeight.get(height);
		if (!existing || bitrate > existing.bitrate) {
			byHeight.set(height, { bitrate });
		}
	}

	// Highest quality first — menu reads top-to-bottom as "best to worst"
	const pairs: { height: number; bitrate: number }[] = [];
	for (const [height, { bitrate }] of byHeight.entries()) {
		pairs.push({ height, bitrate });
	}
	pairs.sort((a, b) => b.height - a.height);
	return pairs.map((lvl, index) => ({ index, ...lvl }));
}

/** Parse quality levels from a DASH manifest XML. Invidious's /api/v1/videos
 *  is unreliable post-SABR (often returns empty adaptiveFormats), so we parse
 *  the DASH manifest directly — it's what dash.js will actually play. */
export function extractLevelsFromDash(manifestXml: string): SessionLevel[] {
	// Match <Representation ... height="N" ... bandwidth="M"> (or bandwidth before height).
	// Video representations only — skip audio.
	const repRegex = /<Representation\b[^>]*>/g;
	const byHeight = new Map<number, { bitrate: number }>();

	for (const match of manifestXml.matchAll(repRegex)) {
		const tag = match[0];
		const heightMatch = tag.match(/\bheight="(\d+)"/);
		const bandwidthMatch = tag.match(/\bbandwidth="(\d+)"/);
		if (!heightMatch) continue; // audio reps have no height
		const height = parseInt(heightMatch[1]);
		const bitrate = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;
		if (!isFinite(height) || height <= 0) continue;
		const existing = byHeight.get(height);
		if (!existing || bitrate > existing.bitrate) {
			byHeight.set(height, { bitrate });
		}
	}

	// Highest quality first
	const pairs: { height: number; bitrate: number }[] = [];
	for (const [height, { bitrate }] of byHeight.entries()) {
		pairs.push({ height, bitrate });
	}
	pairs.sort((a, b) => b.height - a.height);
	return pairs.map((lvl, index) => ({ index, ...lvl }));
}

const PREFERRED_MUXED_ITAGS = ['22', '18'];

export function pickBestFormat(
	formats: any[],
	caps: BrowserCaps,
	plan: PlaybackPlan
): { itag: string; mimeType?: string; qualityLabel?: string; height?: number } | null {
	if (!formats.length) return null;

	// Filter to muxed formats (have both video + audio in one stream)
	const muxed = formats.filter(
		(f) => f.container === 'mp4' && (f.resolution || f.qualityLabel)
	);

	// Parse height from qualityLabel (e.g., "720p" → 720)
	const withHeight = muxed.map((f) => {
		const h = parseInt(String(f.qualityLabel ?? f.resolution ?? '0'));
		return { ...f, height: isNaN(h) ? 0 : h };
	});

	// Filter by targetHeight if set
	const heightCap = plan.targetHeight ?? Infinity;
	const eligible = withHeight.filter((f) => f.height <= heightCap);

	if (!eligible.length) {
		// Nothing under the cap — return lowest available
		const sorted = withHeight.sort((a, b) => a.height - b.height);
		return sorted[0] ?? null;
	}

	// Prefer highest-quality eligible format
	eligible.sort((a, b) => b.height - a.height);

	// Prefer known good itags within same height
	for (const itag of PREFERRED_MUXED_ITAGS) {
		const match = eligible.find((f) => f.itag === itag);
		if (match) return match;
	}

	return eligible[0] ?? null;
}

export async function invidiousNegotiatePlayback(
	config: ServiceConfig,
	userCred: UserCredential | undefined,
	item: { id: string; type: string; title?: string },
	plan: PlaybackPlan,
	caps: BrowserCaps
): Promise<PlaybackSession> {
	const videoId = item.id;
	const baseUrl = config.url.replace(/\/+$/, '');

	// Fetch available formats
	const res = await fetch(
		`${baseUrl}/api/v1/videos/${encodeURIComponent(videoId)}?fields=formatStreams,adaptiveFormats`,
		{ signal: AbortSignal.timeout(8000) }
	);
	if (!res.ok) throw new Error(`Invidious /api/v1/videos failed: ${res.status}`);
	const meta = await res.json();

	const allFormats = [...(meta.formatStreams ?? []), ...(meta.adaptiveFormats ?? [])];
	const picked = pickBestFormat(allFormats, caps, plan);
	const itag = picked?.itag ?? '18';

	// Fetch captions list — Invidious exposes them at /api/v1/captions/{id}
	// and each entry has a relative `url` that serves WebVTT. We surface
	// the full URL on TrackInfo so the player can inject <track> elements.
	let subtitleTracks: PlaybackSession['subtitleTracks'] = [];
	try {
		const capRes = await fetch(
			`${baseUrl}/api/v1/captions/${encodeURIComponent(videoId)}`,
			{ signal: AbortSignal.timeout(5000) }
		);
		if (capRes.ok) {
			const capData = await capRes.json();
			subtitleTracks = (capData.captions ?? []).map((c: any, i: number) => ({
				id: i,
				name: c.label ?? c.language_code ?? `Caption ${i}`,
				lang: c.language_code ?? '',
				// Route through our proxy so the browser only talks to Nexus
				// (Invidious origin is often host.docker.internal from Nexus's
				// perspective, which browsers can't resolve) and CORS is a
				// non-issue.
				url: `/api/video/stream/${encodeURIComponent(videoId)}/captions?label=${encodeURIComponent(c.label ?? c.language_code ?? '')}`,
				isExternal: true,
			}));
		}
	} catch { /* captions are optional */ }

	// Post-SABR Invidious routinely returns empty adaptiveFormats from
	// /api/v1/videos — the real data lives in the companion-backed DASH
	// manifest. Fetch it and parse levels from the XML directly. If that
	// also comes back empty, fall through to progressive muxed as a last
	// resort.
	let dashLevels: SessionLevel[] = [];
	let dashAvailable = false;
	try {
		const dashRes = await fetch(
			`${baseUrl}/api/manifest/dash/id/${encodeURIComponent(videoId)}`,
			{ signal: AbortSignal.timeout(8000) }
		);
		if (dashRes.ok) {
			const mpd = await dashRes.text();
			dashLevels = extractLevelsFromDash(mpd);
			dashAvailable = mpd.includes('<Representation') && dashLevels.length > 0;
		}
	} catch { /* fall through */ }

	// Legacy adaptiveFormats as a fallback (rarely useful post-SABR)
	if (!dashAvailable && (meta.adaptiveFormats ?? []).length > 0) {
		dashLevels = extractLevels(meta.adaptiveFormats);
		dashAvailable = dashLevels.length > 0;
	}

	// Source height for the quality menu cap. For DASH, the largest level
	// matches the upload resolution. For progressive we fall back to the
	// picked format's height (single-stream itag).
	const sourceHeight = dashAvailable
		? dashLevels.reduce((m, l) => (l.height > m ? l.height : m), 0) || undefined
		: (typeof picked?.height === 'number' ? picked.height : undefined);

	const session: PlaybackSession = {
		engine: dashAvailable ? 'dash' : 'progressive',
		url: dashAvailable
			? `/api/video/stream/${encodeURIComponent(videoId)}/dash`
			: `/api/video/stream/${encodeURIComponent(videoId)}?itag=${itag}`,
		mime: dashAvailable ? 'application/dash+xml' : (picked?.mimeType ?? 'video/mp4'),
		mode: 'direct-play',
		audioTracks: [{ id: 0, name: 'Default', lang: '' }],
		subtitleTracks,
		burnableSubtitleTracks: [],
		levels: dashAvailable ? dashLevels : undefined,
		sourceHeight,
	};

	session.changeQuality = async (newPlan: PlaybackPlan) => {
		return invidiousNegotiatePlayback(config, userCred, item, { ...plan, ...newPlan }, caps);
	};

	return session;
}
