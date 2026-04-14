import { json } from '@sveltejs/kit';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { invidiousCookieHeaders } from '$lib/adapters/invidious/client';
import type { RequestHandler } from './$types';

/**
 * Returns available stream formats for an Invidious video.
 * Used by the Player to populate the quality selection menu.
 *
 * Returns both muxed formats and adaptive (video-only) formats,
 * deduplicated to one entry per resolution (preferring h264 for compatibility).
 * Also returns audio formats for synced playback with adaptive video.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { videoId } = params;
	const invConfig = getConfigsForMediaType('video')[0];
	if (!invConfig) return json({ error: 'No Invidious service' }, { status: 404 });

	const userCred = getUserCredentialForService(locals.user.id, invConfig.id) ?? undefined;
	const headers: Record<string, string> = { ...invidiousCookieHeaders(userCred) };

	const res = await fetch(
		`${invConfig.url}/api/v1/videos/${encodeURIComponent(videoId)}`,
		{ headers, signal: AbortSignal.timeout(10_000) }
	);
	if (!res.ok) return json({ error: 'Failed to fetch' }, { status: res.status });

	const meta = await res.json();

	// Collect all video formats (muxed + adaptive video-only)
	const allVideoFormats: any[] = [];

	// Muxed formats first (video+audio)
	for (const f of (meta.formatStreams ?? [])) {
		allVideoFormats.push({
			itag: f.itag,
			quality: f.qualityLabel ?? f.quality ?? 'Unknown',
			type: f.type ?? f.mimeType ?? 'video/mp4',
			muxed: true,
			isAudio: false
		});
	}

	// Adaptive video formats — deduplicate per resolution, prefer h264 > av1 > vp9
	const adaptiveVideo = (meta.adaptiveFormats ?? []).filter(
		(f: any) => (f.type ?? '').startsWith('video/')
	);

	const byQuality = new Map<string, any>();
	// Sort: h264 first, then av1, then vp9
	const codecPriority = (type: string) => {
		if (type.includes('avc1')) return 0;
		if (type.includes('av01')) return 1;
		return 2;
	};
	const sorted = [...adaptiveVideo].sort(
		(a: any, b: any) => codecPriority(a.type ?? '') - codecPriority(b.type ?? '')
	);
	for (const f of sorted) {
		const q = f.qualityLabel ?? f.quality ?? 'Unknown';
		if (!byQuality.has(q)) {
			byQuality.set(q, {
				itag: f.itag,
				quality: q,
				type: f.type ?? f.mimeType ?? 'video/mp4',
				muxed: false,
				isAudio: false
			});
		}
	}

	// Only add adaptive qualities that don't already exist as muxed
	const muxedQualities = new Set(allVideoFormats.map(f => f.quality));
	for (const [q, fmt] of byQuality) {
		if (!muxedQualities.has(q)) {
			allVideoFormats.push(fmt);
		}
	}

	// Sort: muxed first (reliable audio), then by resolution descending
	allVideoFormats.sort((a, b) => {
		// Muxed formats first at each resolution
		const resA = parseInt(a.quality) || 0;
		const resB = parseInt(b.quality) || 0;
		if (resA !== resB) return resB - resA;
		// Same resolution: prefer muxed
		if (a.muxed && !b.muxed) return -1;
		if (!a.muxed && b.muxed) return 1;
		return 0;
	});

	// Audio formats for synced playback
	const audioFormats = (meta.adaptiveFormats ?? [])
		.filter((f: any) => (f.type ?? '').startsWith('audio/'))
		.map((f: any) => ({
			itag: f.itag,
			quality: f.bitrate ? `${Math.round(Number(f.bitrate) / 1000)}kbps` : 'Audio',
			type: f.type ?? f.mimeType ?? 'audio/mp4',
			muxed: false,
			isAudio: true
		}));

	return json({
		formatStreams: [...allVideoFormats, ...audioFormats]
	});
};
