// src/lib/adapters/__tests__/jellyfin-playback.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	mapPlaybackInfoToSession,
	derivePlaybackMode,
	filterTextSubtitles,
	filterImageSubtitles,
	jellyfinNegotiatePlayback,
} from '../jellyfin-playback';

vi.mock('$lib/server/stream-proxy', () => ({
	createStreamSession: async () => null,
}));

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

describe('jellyfinNegotiatePlayback body construction', () => {
	let fetchSpy: any;

	beforeEach(() => {
		fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				PlaySessionId: 'ps-123',
				MediaSources: [
					{
						Id: 'item-1',
						ItemId: 'item-1',
						SupportsDirectPlay: true,
						SupportsDirectStream: true,
						MediaStreams: [{ Type: 'Video', Height: 1080 }],
					},
				],
			}),
		});
		vi.stubGlobal('fetch', fetchSpy);
	});

	const config = { id: 'svc', url: 'https://jf.test', apiKey: 'k' } as any;
	const item = { id: 'item-1', type: 'movie' };
	const caps = { videoCodecs: ['h264'], audioCodecs: ['aac'], containers: ['mp4'] } as any;

	it('maps audioTrackHint to AudioStreamIndex in the POST body (#14)', async () => {
		await jellyfinNegotiatePlayback(config, undefined, item, { audioTrackHint: 3 }, caps);
		const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
		expect(body.AudioStreamIndex).toBe(3);
	});

	it('maps subtitleTrackHint to SubtitleStreamIndex in the POST body (#14)', async () => {
		await jellyfinNegotiatePlayback(config, undefined, item, { subtitleTrackHint: 5 }, caps);
		const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
		expect(body.SubtitleStreamIndex).toBe(5);
	});

	it('burnSubIndex wins over subtitleTrackHint when both are provided', async () => {
		await jellyfinNegotiatePlayback(
			config,
			undefined,
			item,
			{ burnSubIndex: 9, subtitleTrackHint: 5 },
			caps
		);
		const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
		expect(body.SubtitleStreamIndex).toBe(9);
	});

	it('forces transcode when audioTrackHint is present', async () => {
		await jellyfinNegotiatePlayback(config, undefined, item, { audioTrackHint: 3 }, caps);
		const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
		expect(body.EnableDirectPlay).toBe(false);
		expect(body.EnableDirectStream).toBe(false);
	});

	it('forces transcode when subtitleTrackHint is present', async () => {
		await jellyfinNegotiatePlayback(config, undefined, item, { subtitleTrackHint: 5 }, caps);
		const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
		expect(body.EnableDirectPlay).toBe(false);
		expect(body.EnableDirectStream).toBe(false);
	});

	it('leaves direct-play enabled when no quality/track overrides are set', async () => {
		await jellyfinNegotiatePlayback(config, undefined, item, {}, caps);
		const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
		expect(body.EnableDirectPlay).toBe(true);
		expect(body.EnableDirectStream).toBe(true);
		expect(body.AudioStreamIndex).toBeUndefined();
		expect(body.SubtitleStreamIndex).toBeUndefined();
	});
});
