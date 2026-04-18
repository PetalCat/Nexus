import { browser } from '$app/environment';

export interface Track {
	id: string;
	sourceId: string; // raw Jellyfin item ID
	serviceId: string; // which Jellyfin service
	title: string;
	artist: string;
	album: string;
	albumId: string;
	duration: number; // seconds
	image: string;
}

export interface Playlist {
	id: string;
	name: string;
	trackIds: string[];
	createdAt: string;
}

export type RepeatMode = 'off' | 'all' | 'one';
export type QueueMode = 'single' | 'loop' | 'playlist-only' | 'flow';

export const QUEUE_MODES: { value: QueueMode; label: string }[] = [
	{ value: 'single', label: '1 Song' },
	{ value: 'loop', label: 'Loop' },
	{ value: 'playlist-only', label: 'Playlist Only' },
	{ value: 'flow', label: 'Flow' }
];

// ── Player state (Svelte 5 runes-compatible via module-level $state) ──

let _queue = $state<Track[]>([]);
let _currentIndex = $state(0);
let _playing = $state(false);
let _progress = $state(0); // 0-1
let _currentTime = $state(0); // seconds
let _volume = $state(0.75); // 0-1
let _muted = $state(false);
let _shuffle = $state(false);
let _queueMode = $state<QueueMode>('playlist-only');
let _expanded = $state(false);
let _visible = $state(false);
let _loading = $state(false);
let _wasPausedByMedia = $state(false);
let _collapsed = $state(false);

let _recentlyPlayed = $state<string[]>([]);

// ── Real Audio Element ──

let audioElement: HTMLAudioElement;

function initAudio() {
	if (!browser) return;
	audioElement = new Audio();
	audioElement.volume = _volume;
	audioElement.addEventListener('timeupdate', () => {
		_currentTime = audioElement.currentTime;
		_progress = audioElement.duration ? audioElement.currentTime / audioElement.duration : 0;
	});
	audioElement.addEventListener('ended', () => skipNext());
	audioElement.addEventListener('loadstart', () => {
		_loading = true;
	});
	audioElement.addEventListener('canplay', () => {
		_loading = false;
	});
	audioElement.addEventListener('error', (e) => {
		console.error('[music] Audio error:', e);
		_loading = false;
	});
}
if (browser) initAudio();

// ── Load and Play ──

function loadAndPlay(track: Track) {
	if (!audioElement) return;
	const streamUrl = `/api/stream/${track.serviceId}/audio/${track.sourceId}/universal?Container=opus,mp3,aac&AudioCodec=opus&TranscodingContainer=aac&MaxStreamingBitrate=320000`;
	audioElement.src = streamUrl;
	audioElement.play().catch((e) => console.error('[music] Play failed:', e));
	_playing = true;
	_visible = true;
	_collapsed = false;
	updateMediaSession(track);
	reportPlayStart(track);
}

// ── MediaSession API ──

function updateMediaSession(track: Track) {
	if (!browser || !('mediaSession' in navigator)) return;
	navigator.mediaSession.metadata = new MediaMetadata({
		title: track.title,
		artist: track.artist,
		album: track.album,
		artwork: [{ src: track.image, sizes: '512x512', type: 'image/jpeg' }]
	});
	navigator.mediaSession.setActionHandler('play', () => togglePlay());
	navigator.mediaSession.setActionHandler('pause', () => togglePlay());
	navigator.mediaSession.setActionHandler('previoustrack', () => skipPrev());
	navigator.mediaSession.setActionHandler('nexttrack', () => skipNext());
}

// ── Play Session Reporting ──

function reportPlayStart(track: Track) {
	if (!browser) return;
	fetch('/api/ingest/interactions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			mediaId: track.sourceId,
			serviceId: track.serviceId,
			mediaType: 'music',
			source: 'reader'
		})
	}).catch(() => {});
}

// ── Exported Getter Object ──

export const musicPlayer = {
	get queue() {
		return _queue;
	},
	get currentIndex() {
		return _currentIndex;
	},
	get currentTrack() {
		return _queue[_currentIndex] ?? null;
	},
	get playing() {
		return _playing;
	},
	get progress() {
		return _progress;
	},
	get currentTime() {
		return _currentTime;
	},
	get volume() {
		return _volume;
	},
	get muted() {
		return _muted;
	},
	get queueMode() {
		return _queueMode;
	},
	get shuffle() {
		return _shuffle;
	},
	get repeat(): RepeatMode {
		return _queueMode === 'single' ? 'one' : _queueMode === 'loop' ? 'all' : 'off';
	},
	get expanded() {
		return _expanded;
	},
	get visible() {
		return _visible;
	},
	get recentlyPlayed() {
		return _recentlyPlayed;
	},
	get loading() {
		return _loading;
	},
	get collapsed() {
		return _collapsed;
	},
	get wasPausedByMedia() {
		return _wasPausedByMedia;
	},

	setExpanded(v: boolean) {
		_expanded = v;
	},
	toggleExpanded() {
		_expanded = !_expanded;
	}
};

// ── Playback Controls ──

export function playAlbum(tracks: Track[], startIndex = 0) {
	if (!tracks.length) return;
	setQueue(tracks, startIndex);
}

export function playTrack(track: Track) {
	const idx = _queue.findIndex((t) => t.id === track.id);
	if (idx >= 0) {
		_currentIndex = idx;
	} else {
		_queue = [..._queue, track];
		_currentIndex = _queue.length - 1;
	}
	_currentTime = 0;
	_progress = 0;
	addToRecentlyPlayed(track.id);
	loadAndPlay(track);
}

export function setQueue(tracks: Track[], startIndex = 0) {
	_queue = tracks;
	_currentIndex = startIndex;
	_currentTime = 0;
	_progress = 0;
	if (tracks[startIndex]) {
		addToRecentlyPlayed(tracks[startIndex].id);
		loadAndPlay(tracks[startIndex]);
	}
}

export function togglePlay() {
	if (_queue.length === 0) return;
	_playing = !_playing;
	if (_playing) {
		audioElement?.play().catch((e) => console.error('[music] Play failed:', e));
	} else {
		audioElement?.pause();
	}
}

export function skipNext() {
	if (_queue.length === 0) return;

	if (_queueMode === 'single') {
		_currentTime = 0;
		_progress = 0;
		if (audioElement) audioElement.currentTime = 0;
		return;
	}

	if (_shuffle) {
		let next = Math.floor(Math.random() * _queue.length);
		if (next === _currentIndex && _queue.length > 1) {
			next = (next + 1) % _queue.length;
		}
		_currentIndex = next;
	} else {
		const nextIndex = _currentIndex + 1;
		const atEnd = nextIndex >= _queue.length;

		if (atEnd) {
			switch (_queueMode) {
				case 'loop':
					_currentIndex = 0;
					break;

				case 'flow': {
					const currentTrack = _queue[_currentIndex];
					if (currentTrack) {
						fetch(
							`/api/music/instant-mix/${currentTrack.sourceId}?serviceId=${currentTrack.serviceId}`
						)
							.then((r) => r.json())
							.then((data: { tracks: Track[] }) => {
								const queueIds = new Set(_queue.map((t) => t.id));
								const newTracks = (data.tracks ?? []).filter(
									(t: Track) => !queueIds.has(t.id)
								);
								if (newTracks.length > 0) {
									_queue = [..._queue, ...newTracks];
									_currentIndex = nextIndex;
									_currentTime = 0;
									_progress = 0;
									addToRecentlyPlayed(_queue[_currentIndex].id);
									loadAndPlay(_queue[_currentIndex]);
								} else {
									_playing = false;
									audioElement?.pause();
								}
							})
							.catch(() => {
								_playing = false;
								audioElement?.pause();
							});
					}
					return; // async — don't fall through
				}

				case 'playlist-only':
				default:
					_currentIndex = 0;
					_playing = false;
					audioElement?.pause();
					break;
			}
		} else {
			_currentIndex = nextIndex;
		}
	}

	_currentTime = 0;
	_progress = 0;
	const track = _queue[_currentIndex];
	if (track) {
		addToRecentlyPlayed(track.id);
		loadAndPlay(track);
	}
}

export function skipPrev() {
	if (_queue.length === 0) return;
	if (_currentTime > 3) {
		_currentTime = 0;
		_progress = 0;
		if (audioElement) audioElement.currentTime = 0;
		return;
	}
	_currentIndex = (_currentIndex - 1 + _queue.length) % _queue.length;
	_currentTime = 0;
	_progress = 0;
	const track = _queue[_currentIndex];
	if (track) {
		addToRecentlyPlayed(track.id);
		loadAndPlay(track);
	}
}

export function seek(fraction: number) {
	const track = _queue[_currentIndex];
	if (!track) return;
	_progress = Math.max(0, Math.min(1, fraction));
	_currentTime = _progress * track.duration;
	if (audioElement && audioElement.duration) {
		audioElement.currentTime = fraction * audioElement.duration;
	}
}

export function setVolume(v: number) {
	_volume = Math.max(0, Math.min(1, v));
	if (_volume > 0) _muted = false;
	if (audioElement) audioElement.volume = _volume;
}

export function toggleMute() {
	_muted = !_muted;
	if (audioElement) audioElement.muted = _muted;
}

export function setQueueMode(mode: QueueMode) {
	_queueMode = mode;
}

export function cycleQueueMode() {
	const modes: QueueMode[] = ['playlist-only', 'single', 'loop', 'flow'];
	const idx = modes.indexOf(_queueMode);
	_queueMode = modes[(idx + 1) % modes.length];
}

export function toggleShuffle() {
	_shuffle = !_shuffle;
}

export function playIndex(index: number) {
	if (index < 0 || index >= _queue.length) return;
	_currentIndex = index;
	_currentTime = 0;
	_progress = 0;
	const track = _queue[_currentIndex];
	if (track) loadAndPlay(track);
}

export function closePlayer() {
	_playing = false;
	_visible = false;
	if (audioElement) {
		audioElement.pause();
		audioElement.src = '';
	}
}

// ── Media Conflict API ──

export function pauseForMedia() {
	if (_playing && audioElement) {
		_wasPausedByMedia = true;
		audioElement.pause();
		_playing = false;
		_collapsed = true;
	}
}

export function resumeAfterMedia() {
	if (_wasPausedByMedia && audioElement) {
		_wasPausedByMedia = false;
		_collapsed = false;
		audioElement.play().catch(() => {});
		_playing = true;
	}
}

export function collapse() {
	_collapsed = true;
}

export function expand() {
	_collapsed = false;
}

// ── Queue Management ──

export function removeFromQueue(index: number) {
	if (index < 0 || index >= _queue.length) return;
	if (index === _currentIndex) return;
	const next = [..._queue];
	next.splice(index, 1);
	if (index < _currentIndex) {
		_currentIndex -= 1;
	}
	_queue = next;
}

export function moveInQueue(fromIndex: number, toIndex: number) {
	if (fromIndex === toIndex) return;
	if (fromIndex < 0 || fromIndex >= _queue.length) return;
	if (toIndex < 0 || toIndex >= _queue.length) return;
	const next = [..._queue];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(toIndex, 0, moved);
	if (fromIndex === _currentIndex) {
		_currentIndex = toIndex;
	} else if (fromIndex < _currentIndex && toIndex >= _currentIndex) {
		_currentIndex -= 1;
	} else if (fromIndex > _currentIndex && toIndex <= _currentIndex) {
		_currentIndex += 1;
	}
	_queue = next;
}

export function clearUpcoming() {
	if (_queue.length === 0) return;
	_queue = _queue.slice(0, _currentIndex + 1);
}

// ── Liked Songs (server-backed) ──

export async function toggleLikeTrack(trackId: string, serviceId: string) {
	return fetch('/api/music/liked', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ trackId, serviceId })
	}).then((r) => r.ok);
}

// ── Recently Played ──

export function addToRecentlyPlayed(trackId: string) {
	const filtered = _recentlyPlayed.filter((id) => id !== trackId);
	_recentlyPlayed = [trackId, ...filtered].slice(0, 20);
}
