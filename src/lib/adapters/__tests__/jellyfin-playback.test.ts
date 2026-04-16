// src/lib/adapters/__tests__/jellyfin-playback.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
	mapPlaybackInfoToSession,
	derivePlaybackMode,
	filterTextSubtitles,
	filterImageSubtitles,
} from '../jellyfin-playback';

vi.mock('$lib/server/stream-proxy');

describe('derivePlaybackMode', () => {
	it('returns direct-play when TranscodingUrl is absent and SupportsDirectPlay', () => {
		expect(derivePlaybackMode({ SupportsDirectPlay: true, SupportsDirectStream: true })).toBe('direct-play');
	});
	it('returns direct-stream when TranscodingUrl is absent and SupportsDirectStream but not DirectPlay', () => {
		expect(derivePlaybackMode({ SupportsDirectPlay: false, SupportsDirectStream: true })).toBe('direct-stream');
	});
	it('returns transcode when TranscodingUrl is present', () => {
		expect(derivePlaybackMode({ SupportsDirectPlay: false, SupportsDirectStream: false, TranscodingUrl: '/Videos/abc/master.m3u8?x=1' })).toBe('transcode');
	});
});

describe('filterTextSubtitles', () => {
	const streams = [
		{ Index: 1, Type: 'Subtitle', Codec: 'srt', DisplayTitle: 'English', Language: 'eng', IsExternal: true },
		{ Index: 2, Type: 'Subtitle', Codec: 'ass', DisplayTitle: 'Japanese', Language: 'jpn', IsExternal: false },
		{ Index: 3, Type: 'Subtitle', Codec: 'pgssub', DisplayTitle: 'French PGS', Language: 'fre', IsExternal: false },
		{ Index: 4, Type: 'Audio', Codec: 'aac', DisplayTitle: 'English', Language: 'eng', IsExternal: false },
	];

	it('returns only text-based subtitle tracks', () => {
		const result = filterTextSubtitles(streams);
		expect(result).toHaveLength(2);
		expect(result[0].name).toBe('English');
		expect(result[1].name).toBe('Japanese');
	});
});

describe('filterImageSubtitles', () => {
	const streams = [
		{ Index: 1, Type: 'Subtitle', Codec: 'srt', DisplayTitle: 'English', Language: 'eng' },
		{ Index: 3, Type: 'Subtitle', Codec: 'pgssub', DisplayTitle: 'French PGS', Language: 'fre' },
		{ Index: 5, Type: 'Subtitle', Codec: 'dvdsub', DisplayTitle: 'German DVD', Language: 'deu' },
	];

	it('returns only image-based subtitle tracks', () => {
		const result = filterImageSubtitles(streams);
		expect(result).toHaveLength(2);
		expect(result[0].codec).toBe('pgssub');
		expect(result[1].codec).toBe('dvdsub');
	});
});
