import type { BrowserCaps } from '$lib/adapters/playback';

const CODEC_PROBES = {
	video: [
		{ codec: 'avc1.640028', mime: 'video/mp4; codecs="avc1.640028"' },
		{ codec: 'avc1.4d401e', mime: 'video/mp4; codecs="avc1.4d401e"' },
		{ codec: 'hev1.1.6.L93.B0', mime: 'video/mp4; codecs="hev1.1.6.L93.B0"' },
		{ codec: 'hvc1.1.6.L93.B0', mime: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
		{ codec: 'av01.0.08M.08', mime: 'video/mp4; codecs="av01.0.08M.08"' },
		{ codec: 'vp9', mime: 'video/webm; codecs="vp9"' },
		{ codec: 'vp09.00.10.08', mime: 'video/webm; codecs="vp09.00.10.08"' },
		{ codec: 'vp8', mime: 'video/webm; codecs="vp8"' },
	],
	audio: [
		{ codec: 'mp4a.40.2', mime: 'audio/mp4; codecs="mp4a.40.2"' },
		{ codec: 'opus', mime: 'audio/webm; codecs="opus"' },
		{ codec: 'mp3', mime: 'audio/mpeg' },
		{ codec: 'flac', mime: 'audio/flac' },
		{ codec: 'vorbis', mime: 'audio/webm; codecs="vorbis"' },
	],
};

let cached: BrowserCaps | null = null;

export function probeBrowserCaps(): BrowserCaps {
	if (cached) return cached;

	const videoCodecs: string[] = [];
	const audioCodecs: string[] = [];
	const containers: string[] = [];

	if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported) {
		for (const probe of CODEC_PROBES.video) {
			if (MediaSource.isTypeSupported(probe.mime)) {
				videoCodecs.push(probe.codec);
			}
		}
		for (const probe of CODEC_PROBES.audio) {
			if (MediaSource.isTypeSupported(probe.mime)) {
				audioCodecs.push(probe.codec);
			}
		}
	} else {
		// Fallback: assume basic H.264 + AAC
		videoCodecs.push('avc1.640028');
		audioCodecs.push('mp4a.40.2');
	}

	// Container support
	const video = document.createElement('video');
	if (video.canPlayType('video/mp4')) containers.push('mp4');
	if (video.canPlayType('video/webm')) containers.push('webm');
	if (video.canPlayType('application/x-mpegURL') || video.canPlayType('application/vnd.apple.mpegURL')) {
		containers.push('ts');
	}
	if (!containers.includes('mp4')) containers.push('mp4'); // force at minimum
	if (!containers.includes('ts')) containers.push('ts');

	// Snap to a standard HLS ladder. Raw `screen.height * dpr` gives values
	// like 1912 on a retina MBP — Plex's universal transcoder rejects those
	// with 400 (`videoResolution=1920x1912` is invalid). Jellyfin tolerates
	// arbitrary heights because it caps via DeviceProfile, but Plex + other
	// stricter adapters want ladder values. Snap DOWN so we never request a
	// resolution beyond what the physical display can show.
	const rawMax = window.screen.height * (window.devicePixelRatio ?? 1);
	const LADDER = [2160, 1440, 1080, 720, 480];
	const maxHeight = LADDER.find((h) => h <= rawMax) ?? 480;

	cached = { videoCodecs, audioCodecs, containers, maxHeight };
	return cached;
}
