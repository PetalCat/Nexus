import type { ServiceConfig, UserCredential } from './types';
import type { PlaybackPlan, PlaybackSession, BrowserCaps } from './playback';

const PREFERRED_MUXED_ITAGS = ['22', '18'];

export function pickBestFormat(
	formats: any[],
	caps: BrowserCaps,
	plan: PlaybackPlan
): { itag: string; mimeType?: string; qualityLabel?: string } | null {
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

	// Fetch captions list
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
			}));
		}
	} catch { /* captions are optional */ }

	const session: PlaybackSession = {
		engine: 'progressive',
		url: `/api/video/stream/${encodeURIComponent(videoId)}?itag=${itag}`,
		mime: picked?.mimeType ?? 'video/mp4',
		mode: 'direct-play',
		audioTracks: [{ id: 0, name: 'Default', lang: '' }],
		subtitleTracks,
		burnableSubtitleTracks: [],
	};

	session.changeQuality = async (newPlan: PlaybackPlan) => {
		return invidiousNegotiatePlayback(config, userCred, item, { ...plan, ...newPlan }, caps);
	};

	return session;
}
