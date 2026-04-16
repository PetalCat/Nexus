import type { PlaybackSession, PlaybackMode, TrackInfo } from '$lib/adapters/playback';
import type { Level } from './PlayerEngine';

export function createPlayerState() {
	let currentTime = $state(0);
	let duration = $state(0);
	let buffered = $state(0);
	let playing = $state(false);
	let volume = $state(1);
	let muted = $state(false);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// Quality / mode
	let mode = $state<PlaybackMode>('direct-play');
	let levels = $state<Level[]>([]);
	let activeLevel = $state<Level | null>(null);
	let autoQuality = $state(true);
	let qualityLabel = $state('Auto');

	// Tracks
	let audioTracks = $state<TrackInfo[]>([]);
	let subtitleTracks = $state<TrackInfo[]>([]);
	let burnableSubtitleTracks = $state<TrackInfo[]>([]);
	let currentAudioTrack = $state(-1);
	let currentSubtitleTrack = $state(-1);
	let isBurnIn = $state(false);

	// Network
	let measuredBandwidth = $state(0);
	let stallCount = $state(0);

	// Controls
	let showControls = $state(true);
	let activePanel = $state<'none' | 'quality' | 'audio' | 'subtitles'>('none');

	function updateFromSession(session: PlaybackSession) {
		mode = session.mode;
		audioTracks = session.audioTracks;
		subtitleTracks = session.subtitleTracks;
		burnableSubtitleTracks = session.burnableSubtitleTracks;
		if (session.activeLevel) {
			activeLevel = { index: 0, ...session.activeLevel };
		}
	}

	function updateQualityLabel(levels: Level[], activeLevelIndex: number) {
		if (activeLevelIndex === -1 || autoQuality) {
			const h = activeLevel?.height;
			qualityLabel = h ? `Auto (${h}p)` : 'Auto';
		} else {
			const lvl = levels[activeLevelIndex];
			qualityLabel = lvl ? `${lvl.height}p` : 'Manual';
		}
	}

	return {
		get currentTime() { return currentTime; },
		set currentTime(v: number) { currentTime = v; },
		get duration() { return duration; },
		set duration(v: number) { duration = v; },
		get buffered() { return buffered; },
		set buffered(v: number) { buffered = v; },
		get playing() { return playing; },
		set playing(v: boolean) { playing = v; },
		get volume() { return volume; },
		set volume(v: number) { volume = v; },
		get muted() { return muted; },
		set muted(v: boolean) { muted = v; },
		get isLoading() { return isLoading; },
		set isLoading(v: boolean) { isLoading = v; },
		get error() { return error; },
		set error(v: string | null) { error = v; },
		get mode() { return mode; },
		get levels() { return levels; },
		set levels(v: Level[]) { levels = v; },
		get activeLevel() { return activeLevel; },
		set activeLevel(v: Level | null) { activeLevel = v; },
		get autoQuality() { return autoQuality; },
		set autoQuality(v: boolean) { autoQuality = v; },
		get qualityLabel() { return qualityLabel; },
		get audioTracks() { return audioTracks; },
		get subtitleTracks() { return subtitleTracks; },
		get burnableSubtitleTracks() { return burnableSubtitleTracks; },
		get currentAudioTrack() { return currentAudioTrack; },
		set currentAudioTrack(v: number) { currentAudioTrack = v; },
		get currentSubtitleTrack() { return currentSubtitleTrack; },
		set currentSubtitleTrack(v: number) { currentSubtitleTrack = v; },
		get isBurnIn() { return isBurnIn; },
		set isBurnIn(v: boolean) { isBurnIn = v; },
		get measuredBandwidth() { return measuredBandwidth; },
		set measuredBandwidth(v: number) { measuredBandwidth = v; },
		get stallCount() { return stallCount; },
		set stallCount(v: number) { stallCount = v; },
		get showControls() { return showControls; },
		set showControls(v: boolean) { showControls = v; },
		get activePanel() { return activePanel; },
		set activePanel(v: 'none' | 'quality' | 'audio' | 'subtitles') { activePanel = v; },
		updateFromSession,
		updateQualityLabel,
	};
}

export type PlayerState = ReturnType<typeof createPlayerState>;
