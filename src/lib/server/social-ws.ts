import {
	onWsMessage,
	onUserConnect,
	onUserDisconnect,
	broadcastToUser,
	broadcastToUsers,
	broadcastToFriends
} from './ws';
import {
	updatePresence,
	isGhostMode,
	getFriendIds,
	getFriends,
	addSessionMessage,
	getSessionParticipantIds
} from './social';

export function initSocialWsHandlers(): void {
	// ── Presence: track connect/disconnect ────────────────────────
	onUserConnect((userId) => {
		updatePresence(userId, { status: 'online', lastSeen: Date.now() });

		if (!isGhostMode(userId)) {
			broadcastToFriends(userId, {
				type: 'presence:updated',
				data: { userId, status: 'online' }
			}, () => getFriendIds(userId));
		}

		// Send bulk friend status to the newly connected user
		const friends = getFriends(userId);
		broadcastToUser(userId, {
			type: 'presence:friends_status',
			data: {
				friends: friends.map((f) => ({
					userId: f.userId,
					username: f.username,
					displayName: f.displayName,
					status: f.status,
					customStatus: f.customStatus,
					currentActivity: f.currentActivity
				}))
			}
		});
	});

	onUserDisconnect((userId) => {
		updatePresence(userId, { status: 'offline', lastSeen: Date.now(), currentActivity: null });

		if (!isGhostMode(userId)) {
			broadcastToFriends(userId, {
				type: 'presence:updated',
				data: { userId, status: 'offline' }
			}, () => getFriendIds(userId));
		}
	});

	// ── Session WS messages ──────────────────────────────────────
	onWsMessage((userId, msg) => {
		switch (msg.type) {
			case 'session:message': {
				const { sessionId, content, messageType } = msg.data ?? {};
				if (!sessionId || !content) return;

				const msgId = addSessionMessage(
					sessionId as string,
					userId,
					content as string,
					(messageType as string) ?? 'text'
				);

				const participantIds = getSessionParticipantIds(sessionId as string);
				broadcastToUsers(participantIds, {
					type: 'session:message',
					data: {
						sessionId,
						messageId: msgId,
						userId,
						content,
						messageType: (messageType as string) ?? 'text',
						createdAt: Date.now()
					}
				}, userId);
				break;
			}

			case 'session:sync': {
				// Host broadcasts playback position to participants
				const { sessionId, positionMs, isPlaying } = msg.data ?? {};
				if (!sessionId) return;

				const participantIds = getSessionParticipantIds(sessionId as string);
				broadcastToUsers(participantIds, {
					type: 'session:sync',
					data: { sessionId, positionMs, isPlaying, fromUserId: userId }
				}, userId);
				break;
			}
		}
	});
}
