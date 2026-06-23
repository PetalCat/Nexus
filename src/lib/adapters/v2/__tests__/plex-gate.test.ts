/**
 * Unit tests for the Plex client-capability gate (clientMustTranscode), extracted
 * from negotiatePlayback so the direct-play-vs-transcode decision can be pinned
 * without a live PMS. The gate exists because Plex's named "Chrome" profile
 * green-lights codecs the browser can't actually decode — Nexus must gate on the
 * REAL client caps, not Plex's optimistic decision.
 */
import { describe, it, expect } from 'vitest';
import { clientMustTranscode } from '../plex';
import type { BrowserCaps } from '../../playback';

// A maximally-permissive browser: H.264 + HEVC video, AAC + AC3 audio, mp4/mkv.
const fullCaps: BrowserCaps = {
	videoCodecs: ['avc1.640028', 'hev1.1.6.L93.B0'],
	audioCodecs: ['mp4a.40.2', 'ac-3'],
	containers: ['mp4', 'mkv'],
	maxHeight: 2160
};

// H.264-only browser (no HEVC).
const h264OnlyCaps: BrowserCaps = {
	videoCodecs: ['avc1.640028'],
	audioCodecs: ['mp4a.40.2', 'ac-3'],
	containers: ['mp4', 'mkv'],
	maxHeight: 1080
};

// AAC-only audio (no AC3).
const aacOnlyCaps: BrowserCaps = {
	videoCodecs: ['avc1.640028'],
	audioCodecs: ['mp4a.40.2'],
	containers: ['mp4', 'mkv'],
	maxHeight: 1080
};

// mp4-only container (no mkv).
const mp4OnlyCaps: BrowserCaps = {
	videoCodecs: ['avc1.640028'],
	audioCodecs: ['mp4a.40.2'],
	containers: ['mp4'],
	maxHeight: 1080
};

describe('clientMustTranscode — direct-play green-light', () => {
	it('h264 + aac + mp4 under full caps → false (direct-play)', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'h264',
				sourceAudioCodec: 'aac',
				sourceContainer: 'mp4',
				caps: fullCaps,
				forcing: false
			})
		).toBe(false);
	});
});

describe('clientMustTranscode — video codec gate', () => {
	it('hevc under h264-only caps → true (transcode)', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'hevc',
				sourceAudioCodec: 'aac',
				sourceContainer: 'mp4',
				caps: h264OnlyCaps,
				forcing: false
			})
		).toBe(true);
	});

	it('h265 alias is treated like hevc (transcode under h264-only)', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'h265',
				sourceAudioCodec: 'aac',
				sourceContainer: 'mp4',
				caps: h264OnlyCaps,
				forcing: false
			})
		).toBe(true);
	});

	it('hevc under full (hevc-capable) caps → false', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'hevc',
				sourceAudioCodec: 'aac',
				sourceContainer: 'mp4',
				caps: fullCaps,
				forcing: false
			})
		).toBe(false);
	});
});

describe('clientMustTranscode — audio codec gate', () => {
	it('h264 + ac3 under aac-only caps → true (transcode)', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'h264',
				sourceAudioCodec: 'ac3',
				sourceContainer: 'mp4',
				caps: aacOnlyCaps,
				forcing: false
			})
		).toBe(true);
	});

	it('h264 + ac3 under ac3-capable full caps → false', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'h264',
				sourceAudioCodec: 'ac3',
				sourceContainer: 'mp4',
				caps: fullCaps,
				forcing: false
			})
		).toBe(false);
	});

	it('dts (never browser-decodable) → true even under full caps', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'h264',
				sourceAudioCodec: 'dts',
				sourceContainer: 'mp4',
				caps: fullCaps,
				forcing: false
			})
		).toBe(true);
	});
});

describe('clientMustTranscode — container gate', () => {
	it('mkv container under mp4-only caps → true (transcode)', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'h264',
				sourceAudioCodec: 'aac',
				sourceContainer: 'mkv',
				caps: mp4OnlyCaps,
				forcing: false
			})
		).toBe(true);
	});

	it('mkv container when caps explicitly list mkv → false', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'h264',
				sourceAudioCodec: 'aac',
				sourceContainer: 'mkv',
				caps: fullCaps,
				forcing: false
			})
		).toBe(false);
	});

	it('a progressively-playable container (mov) is always allowed', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'h264',
				sourceAudioCodec: 'aac',
				sourceContainer: 'mov',
				caps: mp4OnlyCaps,
				forcing: false
			})
		).toBe(false);
	});
});

describe('clientMustTranscode — unknown codec defers, forcing overrides', () => {
	it('unknown video codec → defers (false) unless forcing', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'av1',
				sourceAudioCodec: 'aac',
				sourceContainer: 'mp4',
				caps: fullCaps,
				forcing: false
			})
		).toBe(false);
	});

	it('empty source codecs/container defer (false) — nothing to gate on', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: '',
				sourceAudioCodec: '',
				sourceContainer: '',
				caps: fullCaps,
				forcing: false
			})
		).toBe(false);
	});

	it('forcing=true always → true (explicit quality/track pick)', () => {
		// Even a perfectly direct-playable source transcodes when the user forced it.
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'h264',
				sourceAudioCodec: 'aac',
				sourceContainer: 'mp4',
				caps: fullCaps,
				forcing: true
			})
		).toBe(true);
	});

	it('forcing=true overrides even an unknown codec that would otherwise defer', () => {
		expect(
			clientMustTranscode({
				sourceVideoCodec: 'av1',
				sourceAudioCodec: '',
				sourceContainer: '',
				caps: fullCaps,
				forcing: true
			})
		).toBe(true);
	});
});
