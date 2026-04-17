import type {
	FriendProfile,
	ActivityEvent,
	SocialSession,
	SharedItem,
	CollaborativePlaylist
} from '$lib/types/media-ui';

let _friends = $state<FriendProfile[]>([]);
let _activityFeed = $state<ActivityEvent[]>([]);
let _sessions = $state<SocialSession[]>([]);
let _sharedItems = $state<SharedItem[]>([]);
let _collabPlaylists = $state<CollaborativePlaylist[]>([]);

// Ghost mode is NOT held here — the canonical single source is the server-
// side `user_presence.ghost_mode` column, surfaced via GET /api/auth/me and
// mutated by server-side `updatePresence()` (see src/lib/server/social.ts
// CANONICAL comment). Any future client ghost UI goes through a new endpoint
// that calls updatePresence; do NOT add a client-side mirror. See #33 + codex-
// review/27 bug B.

export const social = {
	get friends() { return _friends; },
	get onlineFriends() { return _friends.filter((f) => f.status === 'online'); },
	get activityFeed() { return _activityFeed; },
	get sessions() { return _sessions; },
	get sharedItems() { return _sharedItems; },
	get unseenShareCount() { return _sharedItems.filter((s) => !s.seen).length; },
	get collabPlaylists() { return _collabPlaylists; }
};

export function getFriendById(id: string): FriendProfile | undefined {
	return _friends.find((f) => f.id === id);
}

export function getFriendsWhoWatched(mediaId: string): FriendProfile[] {
	return _friends.filter((f) => f.favoriteMedia?.includes(mediaId));
}

export function getOnlineFriendCount(): number {
	return _friends.filter((f) => f.status === 'online').length;
}

export function getActivityFeed(): ActivityEvent[] {
	return _activityFeed;
}

export function getActivityForFriend(friendId: string): ActivityEvent[] {
	return _activityFeed.filter((a) => a.userId === friendId);
}

export function getActivityForMedia(mediaId: string): ActivityEvent[] {
	return _activityFeed.filter((a) => a.mediaId === mediaId);
}

export function getActiveSessions(): SocialSession[] {
	return _sessions.filter((s) => s.status === 'active' || s.status === 'waiting');
}

export function getSessionByMediaId(mediaId: string): SocialSession | undefined {
	return _sessions.find((s) => s.mediaId === mediaId);
}

export function getSessionById(id: string): SocialSession | undefined {
	return _sessions.find((s) => s.id === id);
}

export function getSharedItems(): SharedItem[] {
	return _sharedItems;
}

export function getUnseenSharedCount(): number {
	return _sharedItems.filter((s) => !s.seen).length;
}

export function markSharedAsSeen(id: string): void {
	_sharedItems = _sharedItems.map((s) =>
		s.id === id ? { ...s, seen: true } : s
	);
}

export function getCollabPlaylists(): CollaborativePlaylist[] {
	return _collabPlaylists;
}

export function getCollabPlaylistById(id: string): CollaborativePlaylist | undefined {
	return _collabPlaylists.find((p) => p.id === id);
}
