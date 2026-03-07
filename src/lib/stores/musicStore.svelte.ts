export interface Track {
	id: string;
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

// Track library — populated via setTrackLibrary()
let allAlbumTracks: Track[] = [];

export function setTrackLibrary(tracks: Track[]) {
	allAlbumTracks = tracks;
}

export function getTracksForAlbum(albumId: string): Track[] {
	return allAlbumTracks.filter((t) => t.albumId === albumId);
}

export function getAllTracks(): Track[] {
	return allAlbumTracks;
}

// ── Liked / Playlist / Recently Played state ──

let _likedSongs = $state<Set<string>>(new Set());

let _playlists = $state<Playlist[]>([]);

let _recentlyPlayed = $state<string[]>([]);

// ── Player state (Svelte 5 runes-compatible via module-level $state) ──

let _queue = $state<Track[]>([]);
let _currentIndex = $state(0);
let _playing = $state(false);
let _progress = $state(0); // 0–1
let _currentTime = $state(0); // seconds
let _volume = $state(0.75); // 0–1
let _muted = $state(false);
let _shuffle = $state(false);
let _queueMode = $state<QueueMode>('playlist-only');
let _expanded = $state(false);
let _visible = $state(false);

// Simulated playback timer
let _interval: ReturnType<typeof setInterval> | null = null;

function startPlayback() {
	stopPlayback();
	_interval = setInterval(() => {
		const track = _queue[_currentIndex];
		if (!track) return;
		_currentTime += 0.25;
		_progress = _currentTime / track.duration;
		if (_currentTime >= track.duration) {
			skipNext();
		}
	}, 250);
}

function stopPlayback() {
	if (_interval) {
		clearInterval(_interval);
		_interval = null;
	}
}

export const musicPlayer = {
	get queue() { return _queue; },
	get currentIndex() { return _currentIndex; },
	get currentTrack() { return _queue[_currentIndex] ?? null; },
	get playing() { return _playing; },
	get progress() { return _progress; },
	get currentTime() { return _currentTime; },
	get volume() { return _volume; },
	get muted() { return _muted; },
	get queueMode() { return _queueMode; },
	get shuffle() { return _shuffle; },
	get repeat(): RepeatMode { return _queueMode === 'single' ? 'one' : _queueMode === 'loop' ? 'all' : 'off'; },
	get expanded() { return _expanded; },
	get visible() { return _visible; },
	get likedSongs() { return _likedSongs; },
	get playlists() { return _playlists; },
	get recentlyPlayed() { return _recentlyPlayed; },

	setExpanded(v: boolean) { _expanded = v; },
	toggleExpanded() { _expanded = !_expanded; },
};

export function playAlbum(albumId: string, startIndex = 0) {
	const tracks = getTracksForAlbum(albumId);
	if (tracks.length === 0) return;
	_queue = tracks;
	_currentIndex = startIndex;
	_currentTime = 0;
	_progress = 0;
	_playing = true;
	_visible = true;
	addToRecentlyPlayed(tracks[startIndex].id);
	startPlayback();
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
	_playing = true;
	_visible = true;
	addToRecentlyPlayed(track.id);
	startPlayback();
}

export function setQueue(tracks: Track[], startIndex = 0) {
	_queue = tracks;
	_currentIndex = startIndex;
	_currentTime = 0;
	_progress = 0;
	_playing = true;
	_visible = true;
	if (tracks[startIndex]) addToRecentlyPlayed(tracks[startIndex].id);
	startPlayback();
}

export function togglePlay() {
	if (_queue.length === 0) return;
	_playing = !_playing;
	if (_playing) {
		startPlayback();
	} else {
		stopPlayback();
	}
}

export function skipNext() {
	if (_queue.length === 0) return;

	if (_queueMode === 'single') {
		_currentTime = 0;
		_progress = 0;
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
					const queueIds = new Set(_queue.map((t) => t.id));
					const recs = getRecommendedTracks().filter((t) => !queueIds.has(t.id));
					if (recs.length > 0) {
						_queue = [..._queue, ...recs];
						_currentIndex = nextIndex;
					} else {
						_playing = false;
						stopPlayback();
					}
					break;
				}

				case 'playlist-only':
				default:
					_currentIndex = 0;
					_playing = false;
					stopPlayback();
					break;
			}
		} else {
			_currentIndex = nextIndex;
		}
	}

	_currentTime = 0;
	_progress = 0;
	if (_queue[_currentIndex]) addToRecentlyPlayed(_queue[_currentIndex].id);
}

export function skipPrev() {
	if (_queue.length === 0) return;
	if (_currentTime > 3) {
		_currentTime = 0;
		_progress = 0;
		return;
	}
	_currentIndex = (_currentIndex - 1 + _queue.length) % _queue.length;
	_currentTime = 0;
	_progress = 0;
	if (_queue[_currentIndex]) addToRecentlyPlayed(_queue[_currentIndex].id);
}

export function seek(fraction: number) {
	const track = _queue[_currentIndex];
	if (!track) return;
	_progress = Math.max(0, Math.min(1, fraction));
	_currentTime = _progress * track.duration;
}

export function setVolume(v: number) {
	_volume = Math.max(0, Math.min(1, v));
	if (_volume > 0) _muted = false;
}

export function toggleMute() {
	_muted = !_muted;
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
	_playing = true;
	startPlayback();
}

export function closePlayer() {
	_playing = false;
	_visible = false;
	stopPlayback();
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

// ── Liked Songs ──

export function toggleLikeTrack(trackId: string) {
	const next = new Set(_likedSongs);
	if (next.has(trackId)) {
		next.delete(trackId);
	} else {
		next.add(trackId);
	}
	_likedSongs = next;
}

export function isTrackLiked(trackId: string): boolean {
	return _likedSongs.has(trackId);
}

export function getLikedTracks(): Track[] {
	return allAlbumTracks.filter((t) => _likedSongs.has(t.id));
}

// ── Playlists ──

export function createPlaylist(name: string, trackIds: string[] = []): Playlist {
	const playlist: Playlist = {
		id: `playlist-${Date.now()}`,
		name,
		trackIds,
		createdAt: new Date().toISOString()
	};
	_playlists = [..._playlists, playlist];
	return playlist;
}

export function deletePlaylist(id: string) {
	_playlists = _playlists.filter((p) => p.id !== id);
}

export function renamePlaylist(id: string, name: string) {
	_playlists = _playlists.map((p) => (p.id === id ? { ...p, name } : p));
}

export function addToPlaylist(playlistId: string, trackId: string) {
	_playlists = _playlists.map((p) => {
		if (p.id !== playlistId) return p;
		if (p.trackIds.includes(trackId)) return p;
		return { ...p, trackIds: [...p.trackIds, trackId] };
	});
}

export function removeFromPlaylist(playlistId: string, trackId: string) {
	_playlists = _playlists.map((p) => {
		if (p.id !== playlistId) return p;
		return { ...p, trackIds: p.trackIds.filter((id) => id !== trackId) };
	});
}

export function getPlaylistTracks(playlistId: string): Track[] {
	const playlist = _playlists.find((p) => p.id === playlistId);
	if (!playlist) return [];
	return playlist.trackIds
		.map((id) => allAlbumTracks.find((t) => t.id === id))
		.filter((t): t is Track => t !== undefined);
}

// ── Recently Played ──

export function addToRecentlyPlayed(trackId: string) {
	const filtered = _recentlyPlayed.filter((id) => id !== trackId);
	_recentlyPlayed = [trackId, ...filtered].slice(0, 20);
}

export function getRecentlyPlayedTracks(): Track[] {
	return _recentlyPlayed
		.map((id) => allAlbumTracks.find((t) => t.id === id))
		.filter((t): t is Track => t !== undefined);
}

// ── Playlist Lookup ──

export function getPlaylistById(id: string): Playlist | null {
	return _playlists.find((p) => p.id === id) ?? null;
}

// ── Recommendations ──

export function getRecommendedTracks(): Track[] {
	return allAlbumTracks
		.filter((t) => !_likedSongs.has(t.id))
		.slice(0, 12);
}
