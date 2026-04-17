// === AUTH TYPES ===

export interface AuthUser {
	id: string;
	email: string;
	displayName: string;
	avatar: string;
	forceResetRequired: boolean;
}

export type MediaType = 'movie' | 'show' | 'book' | 'game' | 'music' | 'live' | 'video';

export type MediaSource =
	| 'jellyfin'
	| 'plex'
	| 'kavita'
	| 'romm'
	| 'overseerr'
	| 'invidious'
	| 'manual'
	| 'iptv'
	| 'calibre'
	| 'bazarr';

export type ActionType = 'watch' | 'read' | 'play' | 'request' | 'listen' | 'stream';

export interface UnifiedMedia {
	id: string;
	type: MediaType;
	title: string;
	description: string;
	image: string;
	source: MediaSource;
	metadata: Record<string, any>;
	progress?: number;
	action?: ActionType;
}

export interface NavItem {
	id: string;
	label: string;
	href: string;
	active?: boolean;
}

export const MEDIA_TYPE_CONFIG: Record<
	MediaType,
	{ label: string; gradient: string; color: string }
> = {
	movie: {
		label: 'Movie',
		gradient: 'from-nexus-surface via-accent/15 to-nexus-base',
		color: 'text-accent'
	},
	show: {
		label: 'Series',
		gradient: 'from-nexus-surface via-steel/15 to-nexus-base',
		color: 'text-steel-light'
	},
	book: {
		label: 'Book',
		gradient: 'from-nexus-surface via-steel/20 to-nexus-base',
		color: 'text-steel-light'
	},
	game: {
		label: 'Game',
		gradient: 'from-nexus-surface via-warm/15 to-nexus-base',
		color: 'text-warm-light'
	},
	music: {
		label: 'Music',
		gradient: 'from-nexus-surface via-accent-dim/15 to-nexus-base',
		color: 'text-accent'
	},
	live: {
		label: 'Live',
		gradient: 'from-nexus-surface via-warm/20 to-nexus-deep',
		color: 'text-warm-light'
	},
	video: {
		label: 'Video',
		gradient: 'from-nexus-surface via-warm/15 to-nexus-base',
		color: 'text-warm'
	}
};

export interface SaveState {
	id: string;
	slot: number;
	label: string;
	timestamp: string;
	screenshot: string | null;
	fileSize: string;
	type: 'state' | 'sram';
	isQuickSave?: boolean;
	isAutoSave?: boolean;
}

export interface GameSaveData {
	saves: SaveState[];
	screenshots: string[];
	totalPlayTime: string;
	lastPlayed: string;
	timesCompleted: number;
}

export const ACTION_CONFIG: Record<ActionType, { label: string; variant: string }> = {
	watch: { label: 'Watch', variant: 'accent' },
	read: { label: 'Read', variant: 'steel' },
	play: { label: 'Play', variant: 'warm' },
	request: { label: 'Request', variant: 'outline' },
	listen: { label: 'Listen', variant: 'accent' },
	stream: { label: 'Stream', variant: 'steel' }
};

// === SHOW EPISODE TYPES ===

export interface Episode {
	id: string;
	seasonNumber: number;
	episodeNumber: number;
	title: string;
	description: string;
	image?: string;
	duration: string;
	airDate?: string;
	progress?: number;
}

export interface Season {
	number: number;
	title?: string;
	episodes: Episode[];
}

// === GAMES ENHANCEMENT TYPES ===

export type GameSortOption =
	| 'name-asc'
	| 'name-desc'
	| 'rating'
	| 'year-newest'
	| 'year-oldest'
	| 'last-played'
	| 'completion';

export type GameViewMode = 'grid' | 'list';

export interface RomMetadata {
	fileName: string;
	fileSize: string;
	region: string;
	format: string;
	hash: string;
	discs?: { label: string; fileName: string; fileSize: string }[];
}

export interface PlaySession {
	id: string;
	date: string;
	duration: string;
	durationMinutes: number;
	notes?: string;
	progressBefore?: number;
	progressAfter?: number;
}

export interface PlatformInfo {
	id: string;
	name: string;
	fullName: string;
	manufacturer: string;
	year: number;
	generation: number;
	color: string;
}

export type CollectionId = 'favorites' | 'currently-playing' | 'backlog' | 'completed';

export interface GameCollection {
	id: CollectionId;
	label: string;
	description: string;
	auto: boolean;
}

export const GAME_SORT_OPTIONS: { value: GameSortOption; label: string }[] = [
	{ value: 'name-asc', label: 'Name A-Z' },
	{ value: 'name-desc', label: 'Name Z-A' },
	{ value: 'rating', label: 'Rating' },
	{ value: 'year-newest', label: 'Year (Newest)' },
	{ value: 'year-oldest', label: 'Year (Oldest)' },
	{ value: 'last-played', label: 'Last Played' },
	{ value: 'completion', label: 'Completion %' }
];

// === MUSIC SORT ===

export type MusicSortOption = 'name-asc' | 'name-desc' | 'artist' | 'album' | 'duration';

export const MUSIC_SORT_OPTIONS: { value: MusicSortOption; label: string }[] = [
	{ value: 'name-asc', label: 'Name A-Z' },
	{ value: 'name-desc', label: 'Name Z-A' },
	{ value: 'artist', label: 'Artist' },
	{ value: 'album', label: 'Album' },
	{ value: 'duration', label: 'Duration' }
];

// === LIVE TV TYPES ===

export type ChannelCategory =
	| 'News'
	| 'Sports'
	| 'Movies'
	| 'Entertainment'
	| 'Kids'
	| 'Comedy'
	| 'Documentary'
	| 'Technology'
	| 'Music'
	| 'Classics';

export const CHANNEL_CATEGORY_COLORS: Record<ChannelCategory, string> = {
	News: '#3b82f6',
	Sports: '#22c55e',
	Movies: '#d4a253',
	Entertainment: '#a855f7',
	Kids: '#eab308',
	Comedy: '#f97316',
	Documentary: '#14b8a6',
	Technology: '#06b6d4',
	Music: '#ec4899',
	Classics: '#f59e0b'
};

export type LiveSortOption = 'channel' | 'name-asc' | 'name-desc' | 'category';

export const LIVE_SORT_OPTIONS: { value: LiveSortOption; label: string }[] = [
	{ value: 'channel', label: 'Channel #' },
	{ value: 'name-asc', label: 'Name A-Z' },
	{ value: 'name-desc', label: 'Name Z-A' },
	{ value: 'category', label: 'Category' }
];

export interface ProgramSlot {
	title: string;
	description: string;
	duration: number; // minutes
	genre?: string;
}

// === MEDIA SORT (Movies/Shows) ===

export type MediaSortOption = 'name-asc' | 'name-desc' | 'rating' | 'year-newest' | 'year-oldest';

export const MEDIA_SORT_OPTIONS: { value: MediaSortOption; label: string }[] = [
	{ value: 'name-asc', label: 'Name A-Z' },
	{ value: 'name-desc', label: 'Name Z-A' },
	{ value: 'rating', label: 'Rating' },
	{ value: 'year-newest', label: 'Year (Newest)' },
	{ value: 'year-oldest', label: 'Year (Oldest)' }
];

// === VIDEO TYPES ===

export interface VideoChannel {
	id: string;
	name: string;
	handle: string;
	avatar: string;
	banner: string;
	subscribers: string;
	videoCount: number;
	description: string;
}

export interface VideoPlaylist {
	id: string;
	title: string;
	description: string;
	thumbnail: string;
	videoIds: string[];
	createdAt: string;
}

// === SUBTITLE / BAZARR TYPES ===

export type SubtitleSource = 'bazarr' | 'embedded' | 'manual';
export type SubtitleFormat = 'srt' | 'ass' | 'pgs' | 'vtt';

export interface SubtitleTrack {
	language: string;
	languageCode: string;
	source: SubtitleSource;
	format: SubtitleFormat;
	hearingImpaired: boolean;
	forced?: boolean;
}

export interface SubtitleStatus {
	available: SubtitleTrack[];
	missing: string[];
	wantedLanguages: string[];
	searchNeeded: boolean;
}

export type EpisodeSubtitleMap = Record<string, SubtitleStatus>;
export type MovieSubtitleMap = Record<string, SubtitleStatus>;

// === SOCIAL TYPES ===

export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline' | 'ghost';

export interface FriendProfile {
	id: string;
	displayName: string;
	username: string;
	avatar: string;
	status: PresenceStatus;
	customStatus?: string;
	currentActivity?: ActivityEvent;
	favoriteMedia?: string[];
}

export type ActivityType =
	| 'watched'
	| 'playing'
	| 'listening'
	| 'reading'
	| 'finished'
	| 'rated'
	| 'shared'
	| 'joined_session';

export interface ActivityEvent {
	id: string;
	userId: string;
	type: ActivityType;
	mediaId: string;
	mediaTitle: string;
	mediaType: MediaType;
	mediaImage: string;
	timestamp: string;
	detail?: string;
}

export type SessionType = 'watch_party' | 'listen_party' | 'netplay' | 'co_op';
export type SessionStatus = 'waiting' | 'active' | 'paused';

export interface SessionParticipant {
	userId: string;
	role: 'host' | 'member';
	joinedAt: string;
	voiceActive?: boolean;
}

export interface SessionMessage {
	id: string;
	userId: string;
	text: string;
	timestamp: string;
}

export interface SocialSession {
	id: string;
	type: SessionType;
	hostId: string;
	mediaId: string;
	mediaTitle: string;
	mediaImage: string;
	participants: SessionParticipant[];
	maxParticipants: number;
	status: SessionStatus;
	createdAt: string;
	messages: SessionMessage[];
	invitedIds: string[];
}

export interface SharedItem {
	id: string;
	fromUserId: string;
	toUserId: string;
	mediaId: string;
	mediaTitle: string;
	mediaType: MediaType;
	message?: string;
	timestamp: string;
	seen: boolean;
}

export type PlaylistRole = 'owner' | 'editor' | 'viewer';

export interface PlaylistCollaborator {
	userId: string;
	role: PlaylistRole;
	addedAt: string;
}

export interface CollaborativePlaylist {
	id: string;
	name: string;
	description?: string;
	createdBy: string;
	collaborators: PlaylistCollaborator[];
	trackIds: string[];    // music track IDs (primary use case)
	mediaIds: string[];    // non-music media IDs (movies, books, etc.)
	mediaType: MediaType;  // 'music' is the primary/default type
	createdAt: string;
	updatedAt: string;
	isPublic: boolean;
}
