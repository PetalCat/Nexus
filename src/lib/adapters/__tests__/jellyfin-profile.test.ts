// src/lib/adapters/__tests__/jellyfin-profile.test.ts
import { describe, it, expect } from 'vitest';
import { buildDeviceProfile } from '../jellyfin-profile';
import type { BrowserCaps, PlaybackPlan } from '../playback';

const defaultCaps: BrowserCaps = {
	videoCodecs: ['avc1.640028', 'hev1.1.6.L93.B0'],
	audioCodecs: ['mp4a.40.2', 'opus'],
	containers: ['mp4', 'webm'],
};

describe('buildDeviceProfile', () => {
	it('returns a profile with DirectPlayProfiles and TranscodingProfiles', () => {
		const profile = buildDeviceProfile(defaultCaps, {});
		expect(profile.Name).toBe('Nexus MSE Browser');
		expect(profile.DirectPlayProfiles).toBeDefined();
		expect(profile.DirectPlayProfiles.length).toBeGreaterThan(0);
		expect(profile.TranscodingProfiles).toBeDefined();
		expect(profile.TranscodingProfiles.length).toBeGreaterThan(0);
	});

	it('includes HLS hack DirectPlayProfile', () => {
		const profile = buildDeviceProfile(defaultCaps, {});
		const hlsProfile = profile.DirectPlayProfiles.find(
			(p: any) => p.Container === 'hls'
		);
		expect(hlsProfile).toBeDefined();
		expect(hlsProfile.Type).toBe('Video');
	});

	it('does NOT include MKV in DirectPlayProfiles', () => {
		const profile = buildDeviceProfile(defaultCaps, {});
		const mkvProfile = profile.DirectPlayProfiles.find(
			(p: any) => p.Container?.includes('mkv')
		);
		expect(mkvProfile).toBeUndefined();
	});

	it('sets MaxStreamingBitrate from plan', () => {
		const plan: PlaybackPlan = { maxBitrate: 4_000_000 };
		const profile = buildDeviceProfile(defaultCaps, plan);
		expect(profile.MaxStreamingBitrate).toBe(4_000_000);
	});

	it('uses AAC for HLS transcoding audio (no Opus in fMP4)', () => {
		const profile = buildDeviceProfile(defaultCaps, {});
		const hlsTx = profile.TranscodingProfiles.find(
			(p: any) => p.Protocol === 'hls' && p.Container === 'mp4'
		);
		expect(hlsTx).toBeDefined();
		expect(hlsTx.AudioCodec).toContain('aac');
		expect(hlsTx.AudioCodec).not.toContain('opus');
	});
});
