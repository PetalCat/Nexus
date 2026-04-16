import type { BrowserCaps, PlaybackPlan } from './playback';

/**
 * Build a Jellyfin 10.11 DeviceProfile from browser capabilities and a
 * playback plan. The profile tells Jellyfin what the client can decode so
 * Jellyfin picks the right mode (direct-play / remux / direct-stream /
 * transcode).
 *
 * Shape follows Jellyfin Web's `scripts/browserDeviceProfile.js` pattern,
 * tightened for MSE browsers. See the design spec appendix for rationale.
 */
export function buildDeviceProfile(caps: BrowserCaps, plan: PlaybackPlan) {
	const maxBitrate = plan.maxBitrate ?? 120_000_000;

	// Video codecs the browser reported via MSE.isTypeSupported
	const canH264 = caps.videoCodecs.some((c) => c.startsWith('avc1'));
	const canHEVC = caps.videoCodecs.some((c) => c.startsWith('hev1') || c.startsWith('hvc1'));
	const canAV1 = caps.videoCodecs.some((c) => c.startsWith('av01'));
	const canVP9 = caps.videoCodecs.some((c) => c.startsWith('vp09') || c === 'vp9');
	const canVP8 = caps.videoCodecs.some((c) => c === 'vp8');

	const videoCodecList = [
		canH264 && 'h264',
		canHEVC && 'hevc',
		canAV1 && 'av1',
	].filter(Boolean).join(',') || 'h264';

	const webmVideoCodecList = [
		canVP8 && 'vp8',
		canVP9 && 'vp9',
		canAV1 && 'av1',
	].filter(Boolean).join(',');

	// Direct-play: only containers the browser handles natively
	const directPlayProfiles: any[] = [
		{
			Container: 'mp4,m4v',
			Type: 'Video',
			VideoCodec: videoCodecList,
			AudioCodec: 'aac,mp3,ac3,eac3,opus',
		},
	];
	if (webmVideoCodecList) {
		directPlayProfiles.push({
			Container: 'webm',
			Type: 'Video',
			VideoCodec: webmVideoCodecList,
			AudioCodec: 'vorbis,opus',
		});
	}
	// HLS "hack" — Jellyfin Web pattern. The API can't express "HLS protocol
	// with MP4/TS sub-container" in a capability filter, so we advertise 'hls'
	// as a container and rely on the TranscodingProfiles for the real output.
	directPlayProfiles.push({
		Container: 'hls',
		Type: 'Video',
		VideoCodec: videoCodecList,
		AudioCodec: 'aac,mp3',
	});

	// Transcoding: fMP4-HLS (preferred) + TS-HLS (fallback)
	const transcodingProfiles: any[] = [
		{
			Container: 'mp4',
			Type: 'Video',
			Context: 'Streaming',
			Protocol: 'hls',
			VideoCodec: videoCodecList,
			AudioCodec: 'aac,mp3',
			MaxAudioChannels: '2',
			MinSegments: 1,
			BreakOnNonKeyFrames: true,
		},
		{
			Container: 'ts',
			Type: 'Video',
			Context: 'Streaming',
			Protocol: 'hls',
			VideoCodec: canH264 ? 'h264' : videoCodecList,
			AudioCodec: 'aac,mp3',
			MaxAudioChannels: '2',
			MinSegments: 1,
			BreakOnNonKeyFrames: true,
		},
	];

	return {
		Name: 'Nexus MSE Browser',
		MaxStreamingBitrate: maxBitrate,
		MaxStaticBitrate: 100_000_000,
		DirectPlayProfiles: directPlayProfiles,
		TranscodingProfiles: transcodingProfiles,
		ContainerProfiles: [],
		CodecProfiles: [],
		SubtitleProfiles: [],
	};
}
