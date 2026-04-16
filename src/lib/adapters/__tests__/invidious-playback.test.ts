// src/lib/adapters/__tests__/invidious-playback.test.ts
import { describe, it, expect } from 'vitest';
import { pickBestFormat } from '../invidious-playback';
import type { BrowserCaps, PlaybackPlan } from '../playback';

const defaultCaps: BrowserCaps = {
	videoCodecs: ['avc1.640028'],
	audioCodecs: ['mp4a.40.2', 'opus'],
	containers: ['mp4', 'webm'],
};

const sampleFormats = [
	{ itag: '22', container: 'mp4', resolution: '720p', qualityLabel: '720p', encoding: 'h264', type: 'video/mp4', mimeType: 'video/mp4' },
	{ itag: '18', container: 'mp4', resolution: '360p', qualityLabel: '360p', encoding: 'h264', type: 'video/mp4', mimeType: 'video/mp4' },
	{ itag: '137', container: 'mp4', qualityLabel: '1080p', encoding: 'h264', type: 'video/mp4' },
];

describe('pickBestFormat', () => {
	it('picks highest resolution muxed format by default', () => {
		const result = pickBestFormat(sampleFormats, defaultCaps, {});
		expect(result?.itag).toBe('22'); // 720p muxed
	});

	it('respects targetHeight cap', () => {
		const plan: PlaybackPlan = { targetHeight: 360 };
		const result = pickBestFormat(sampleFormats, defaultCaps, plan);
		expect(result?.itag).toBe('18'); // 360p muxed
	});

	it('returns null for empty format list', () => {
		expect(pickBestFormat([], defaultCaps, {})).toBeNull();
	});
});
