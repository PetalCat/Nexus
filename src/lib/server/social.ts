import { randomBytes } from 'crypto';
import { and, eq, or, sql, desc, inArray } from 'drizzle-orm';
import { getDb, getRawDb, schema } from '../db';

// ── Helpers ──────────────────────────────────────────────────────────────

function genId(): string {
	return randomBytes(16).toString('hex');
}

function now(): number {
	return Date.now();
}

// ── Friends ──────────────────────────────────────────────────────────────

export function getFriendIds(userId: string): string[] {
	const db = getDb();
	const rows = db
		.select()
		.from(schema.friendships)
		.where(
			and(
				eq(schema.friendships.status, 'accepted'),
				or(
					eq(schema.friendships.userId, userId),
					eq(schema.friendships.friendId, userId)
				)
			)
		)
		.all();
	return rows.map((r) => (r.userId === userId ? r.friendId : r.userId));
}

export function areFriends(a: string, b: string): boolean {
	const db = getDb();
	const row = db
		.select()
		.from(schema.friendships)
		.where(
			and(
				eq(schema.friendships.status, 'accepted'),
				or(
					and(eq(schema.friendships.userId, a), eq(schema.friendships.friendId, b)),
					and(eq(schema.friendships.userId, b), eq(schema.friendships.friendId, a))
				)
			)
		)
		.get();
	return !!row;
}

export interface FriendWithPresence {
	userId: string;
	username: string;
	displayName: string;
	avatar: string | null;
	status: string;
	customStatus: string | null;
	currentActivity: unknown | null;
	friendshipId: string;
	since: number;
}

export function getFriends(userId: string): FriendWithPresence[] {
	const db = getDb();
	const rows = db
		.select()
		.from(schema.friendships)
		.where(
			and(
				eq(schema.friendships.status, 'accepted'),
				or(
					eq(schema.friendships.userId, userId),
					eq(schema.friendships.friendId, userId)
				)
			)
		)
		.all();

	const friends: FriendWithPresence[] = [];
	for (const row of rows) {
		const friendId = row.userId === userId ? row.friendId : row.userId;
		const user = db.select().from(schema.users).where(eq(schema.users.id, friendId)).get();
		if (!user) continue;

		const presence = db.select().from(schema.userPresence).where(eq(schema.userPresence.userId, friendId)).get();
		const isGhost = presence?.ghostMode === 1;

		friends.push({
			userId: friendId,
			username: user.username,
			displayName: user.displayName,
			avatar: user.avatar ?? null,
			status: isGhost ? 'offline' : (presence?.status ?? 'offline'),
			customStatus: isGhost ? null : (presence?.customStatus ?? null),
			currentActivity: isGhost ? null : (presence?.currentActivity ? JSON.parse(presence.currentActivity) : null),
			friendshipId: row.id,
			since: row.acceptedAt ?? row.createdAt
		});
	}
	return friends;
}

export function getOnlineFriends(userId: string): FriendWithPresence[] {
	return getFriends(userId).filter((f) => f.status !== 'offline');
}

export interface FriendRequest {
	id: string;
	fromUserId: string;
	fromUsername: string;
	fromDisplayName: string;
	toUserId: string;
	toUsername: string;
	toDisplayName: string;
	createdAt: number;
	direction: 'incoming' | 'outgoing';
}

export function getPendingRequests(userId: string): FriendRequest[] {
	const db = getDb();
	const rows = db
		.select()
		.from(schema.friendships)
		.where(
			and(
				eq(schema.friendships.status, 'pending'),
				or(
					eq(schema.friendships.userId, userId),
					eq(schema.friendships.friendId, userId)
				)
			)
		)
		.all();

	const result: FriendRequest[] = [];
	for (const row of rows) {
		const fromUser = db.select().from(schema.users).where(eq(schema.users.id, row.userId)).get();
		const toUser = db.select().from(schema.users).where(eq(schema.users.id, row.friendId)).get();
		if (!fromUser || !toUser) continue;

		result.push({
			id: row.id,
			fromUserId: row.userId,
			fromUsername: fromUser.username,
			fromDisplayName: fromUser.displayName,
			toUserId: row.friendId,
			toUsername: toUser.username,
			toDisplayName: toUser.displayName,
			createdAt: row.createdAt,
			direction: row.userId === userId ? 'outgoing' : 'incoming'
		});
	}
	return result;
}

export function sendFriendRequest(fromId: string, toId: string): { id: string } | { error: string } {
	if (fromId === toId) return { error: 'Cannot friend yourself' };

	const db = getDb();

	// Check existing
	const existing = db
		.select()
		.from(schema.friendships)
		.where(
			or(
				and(eq(schema.friendships.userId, fromId), eq(schema.friendships.friendId, toId)),
				and(eq(schema.friendships.userId, toId), eq(schema.friendships.friendId, fromId))
			)
		)
		.get();

	if (existing) {
		if (existing.status === 'accepted') return { error: 'Already friends' };
		if (existing.status === 'pending') return { error: 'Request already pending' };
		if (existing.status === 'blocked') return { error: 'Cannot send request' };
	}

	const id = genId();
	db.insert(schema.friendships).values({
		id,
		userId: fromId,
		friendId: toId,
		status: 'pending',
		createdAt: now()
	}).run();
	return { id };
}

export function acceptFriendRequest(requestId: string, userId: string): boolean {
	const db = getDb();
	const row = db.select().from(schema.friendships).where(eq(schema.friendships.id, requestId)).get();
	if (!row || row.status !== 'pending' || row.friendId !== userId) return false;

	db.update(schema.friendships)
		.set({ status: 'accepted', acceptedAt: now() })
		.where(eq(schema.friendships.id, requestId))
		.run();
	return true;
}

export function declineFriendRequest(requestId: string, userId: string): boolean {
	const db = getDb();
	const row = db.select().from(schema.friendships).where(eq(schema.friendships.id, requestId)).get();
	if (!row || row.status !== 'pending' || row.friendId !== userId) return false;

	db.delete(schema.friendships).where(eq(schema.friendships.id, requestId)).run();
	return true;
}

export function removeFriend(userId: string, friendId: string): boolean {
	const db = getDb();
	const result = db
		.delete(schema.friendships)
		.where(
			and(
				eq(schema.friendships.status, 'accepted'),
				or(
					and(eq(schema.friendships.userId, userId), eq(schema.friendships.friendId, friendId)),
					and(eq(schema.friendships.userId, friendId), eq(schema.friendships.friendId, userId))
				)
			)
		)
		.run();
	return result.changes > 0;
}

export function blockUser(userId: string, targetId: string): boolean {
	if (userId === targetId) return false;

	const db = getDb();

	// Check for existing friendship row in either direction
	const existing = db
		.select()
		.from(schema.friendships)
		.where(
			or(
				and(eq(schema.friendships.userId, userId), eq(schema.friendships.friendId, targetId)),
				and(eq(schema.friendships.userId, targetId), eq(schema.friendships.friendId, userId))
			)
		)
		.get();

	if (existing) {
		if (existing.status === 'blocked' && existing.userId === userId) return true; // already blocked by us
		// Delete the existing row and create a new one with blocker as userId
		db.delete(schema.friendships).where(eq(schema.friendships.id, existing.id)).run();
	}

	const id = genId();
	db.insert(schema.friendships).values({
		id,
		userId, // blocker
		friendId: targetId, // blocked
		status: 'blocked',
		createdAt: now()
	}).run();
	return true;
}

export function unblockUser(userId: string, targetId: string): boolean {
	const db = getDb();
	const result = db
		.delete(schema.friendships)
		.where(
			and(
				eq(schema.friendships.status, 'blocked'),
				eq(schema.friendships.userId, userId),
				eq(schema.friendships.friendId, targetId)
			)
		)
		.run();
	return result.changes > 0;
}

export function getBlockedUserIds(userId: string): string[] {
	const db = getDb();
	// Users that userId has blocked
	const blocked = db
		.select({ friendId: schema.friendships.friendId })
		.from(schema.friendships)
		.where(
			and(
				eq(schema.friendships.status, 'blocked'),
				eq(schema.friendships.userId, userId)
			)
		)
		.all();
	return blocked.map((r) => r.friendId);
}

export function getBlockedByUserIds(userId: string): string[] {
	const db = getDb();
	// Users who have blocked userId
	const blockedBy = db
		.select({ userId: schema.friendships.userId })
		.from(schema.friendships)
		.where(
			and(
				eq(schema.friendships.status, 'blocked'),
				eq(schema.friendships.friendId, userId)
			)
		)
		.all();
	return blockedBy.map((r) => r.userId);
}

// ── Presence ─────────────────────────────────────────────────────────────

export function getPresence(userId: string) {
	const db = getDb();
	return db.select().from(schema.userPresence).where(eq(schema.userPresence.userId, userId)).get() ?? null;
}

export function updatePresence(userId: string, updates: {
	status?: string;
	customStatus?: string | null;
	ghostMode?: boolean;
	currentActivity?: unknown | null;
	lastSeen?: number;
}): void {
	const db = getDb();
	const existing = db.select().from(schema.userPresence).where(eq(schema.userPresence.userId, userId)).get();

	const data: Record<string, unknown> = {};
	if (updates.status !== undefined) data.status = updates.status;
	if (updates.customStatus !== undefined) data.customStatus = updates.customStatus;
	if (updates.ghostMode !== undefined) data.ghostMode = updates.ghostMode ? 1 : 0;
	if (updates.currentActivity !== undefined) data.currentActivity = updates.currentActivity ? JSON.stringify(updates.currentActivity) : null;
	if (updates.lastSeen !== undefined) data.lastSeen = updates.lastSeen;

	if (!existing) {
		db.insert(schema.userPresence).values({
			userId,
			status: (data.status as string) ?? 'online',
			customStatus: (data.customStatus as string) ?? null,
			ghostMode: (data.ghostMode as number) ?? 0,
			currentActivity: (data.currentActivity as string) ?? null,
			lastSeen: (data.lastSeen as number) ?? now()
		}).run();
	} else {
		db.update(schema.userPresence)
			.set(data)
			.where(eq(schema.userPresence.userId, userId))
			.run();
	}
}

export function isGhostMode(userId: string): boolean {
	const presence = getPresence(userId);
	return presence?.ghostMode === 1;
}

// ── Sharing ──────────────────────────────────────────────────────────────

export interface ShareInput {
	mediaId: string;
	serviceId: string;
	mediaType: string;
	mediaTitle: string;
	mediaPoster?: string;
	message?: string;
}

export function shareItem(fromUserId: string, toUserIds: string[], media: ShareInput): string[] {
	const db = getDb();
	const ids: string[] = [];
	for (const toUserId of toUserIds) {
		const id = genId();
		db.insert(schema.sharedItems).values({
			id,
			fromUserId,
			toUserId,
			mediaId: media.mediaId,
			serviceId: media.serviceId,
			mediaType: media.mediaType,
			mediaTitle: media.mediaTitle,
			mediaPoster: media.mediaPoster ?? null,
			message: media.message ?? null,
			seen: 0,
			createdAt: now()
		}).run();
		ids.push(id);
	}
	return ids;
}

export function getSharedItems(userId: string, opts?: { limit?: number; offset?: number; unseenOnly?: boolean }) {
	const db = getDb();
	const limit = opts?.limit ?? 50;
	const offset = opts?.offset ?? 0;

	const conditions = [eq(schema.sharedItems.toUserId, userId)];
	if (opts?.unseenOnly) {
		conditions.push(eq(schema.sharedItems.seen, 0));
	}

	const items = db
		.select()
		.from(schema.sharedItems)
		.where(and(...conditions))
		.orderBy(desc(schema.sharedItems.createdAt))
		.limit(limit)
		.offset(offset)
		.all();

	// Enrich with sender info
	return items.map((item) => {
		const sender = db.select({ username: schema.users.username, displayName: schema.users.displayName, avatar: schema.users.avatar })
			.from(schema.users).where(eq(schema.users.id, item.fromUserId)).get();
		return { ...item, fromUsername: sender?.username, fromDisplayName: sender?.displayName, fromAvatar: sender?.avatar ?? null };
	});
}

export function markSharedSeen(shareId: string, userId: string): boolean {
	const db = getDb();
	const result = db
		.update(schema.sharedItems)
		.set({ seen: 1, seenAt: now() })
		.where(and(eq(schema.sharedItems.id, shareId), eq(schema.sharedItems.toUserId, userId)))
		.run();
	return result.changes > 0;
}

export function getUnseenShareCount(userId: string): number {
	const db = getDb();
	const result = db.get<{ n: number }>(
		sql`SELECT COUNT(*) as n FROM shared_items WHERE to_user_id = ${userId} AND seen = 0`
	);
	return result?.n ?? 0;
}

// ── Activity Feed ────────────────────────────────────────────────────────

export function getFriendActivity(userId: string, opts?: { limit?: number; offset?: number; mediaId?: string; serviceId?: string }) {
	const db = getDb();
	const friendIds = getFriendIds(userId);
	if (friendIds.length === 0) return [];

	// Filter out ghost mode users
	const ghostIds = new Set<string>();
	for (const fid of friendIds) {
		if (isGhostMode(fid)) ghostIds.add(fid);
	}
	const visibleFriends = friendIds.filter((f) => !ghostIds.has(f));
	if (visibleFriends.length === 0) return [];

	const limit = opts?.limit ?? 50;
	const offset = opts?.offset ?? 0;

	const conds = ['user_id IN (' + visibleFriends.map(() => '?').join(',') + ')'];
	const sqlParams: (string | number)[] = [...visibleFriends];
	if (opts?.mediaId) {
		conds.push('media_id = ?');
		sqlParams.push(opts.mediaId);
	}
	if (opts?.serviceId) {
		conds.push('service_id = ?');
		sqlParams.push(opts.serviceId);
	}
	sqlParams.push(limit, offset);

	const raw = getRawDb();
	const events = raw.prepare(
		`SELECT * FROM play_sessions WHERE ${conds.join(' AND ')} ORDER BY started_at DESC LIMIT ? OFFSET ?`
	).all(...sqlParams) as any[];

	// Enrich with user info
	return events.map((e: any) => {
		const uid = e.user_id ?? e.userId;
		const user = db.select({ username: schema.users.username, displayName: schema.users.displayName, avatar: schema.users.avatar })
			.from(schema.users).where(eq(schema.users.id, uid)).get();
		return { ...e, userId: uid, username: user?.username, displayName: user?.displayName, avatar: user?.avatar ?? null };
	});
}

export function getMediaFriendActivity(userId: string, mediaId: string, serviceId: string) {
	const friendIds = getFriendIds(userId);
	if (friendIds.length === 0) return { watched: [], watching: [], shared: [] };

	const db = getDb();
	const visibleFriends = friendIds.filter((f) => !isGhostMode(f));

	// Who completed this media
	const raw = getRawDb();
	const placeholders = visibleFriends.map(() => '?').join(',');
	const watched = raw.prepare(
		`SELECT * FROM media_actions WHERE user_id IN (${placeholders}) AND media_id = ? AND action_type = 'complete'`
	).all(...visibleFriends, mediaId) as any[];

	// Who is currently watching (has play_start without play_stop after)
	const watching: typeof watched = []; // Simplified: derived from presence

	// Who shared it
	const shared = db
		.select()
		.from(schema.sharedItems)
		.where(
			and(
				eq(schema.sharedItems.mediaId, mediaId),
				or(
					and(eq(schema.sharedItems.fromUserId, userId), inArray(schema.sharedItems.toUserId, visibleFriends)),
					and(eq(schema.sharedItems.toUserId, userId), inArray(schema.sharedItems.fromUserId, visibleFriends))
				)
			)
		)
		.all();

	// Who has this in their watchlist
	const watchlisted = db
		.select()
		.from(schema.userWatchlist)
		.where(
			and(
				inArray(schema.userWatchlist.userId, visibleFriends),
				eq(schema.userWatchlist.mediaId, mediaId)
			)
		)
		.all();

	return { watched, watching, shared, watchlisted };
}

// ── Watch Sessions ───────────────────────────────────────────────────────

export function createWatchSession(hostId: string, data: {
	type: string;
	mediaId: string;
	serviceId: string;
	mediaTitle: string;
	mediaType: string;
	maxParticipants?: number;
	invitedIds?: string[];
}): string {
	const db = getDb();
	const id = genId();
	const ts = now();

	db.insert(schema.watchSessions).values({
		id,
		hostId,
		type: data.type,
		mediaId: data.mediaId,
		serviceId: data.serviceId,
		mediaTitle: data.mediaTitle,
		mediaType: data.mediaType,
		maxParticipants: data.maxParticipants ?? 0,
		invitedIds: data.invitedIds?.length ? JSON.stringify(data.invitedIds) : null,
		createdAt: ts
	}).run();

	// Host joins automatically
	db.insert(schema.sessionParticipants).values({
		sessionId: id,
		userId: hostId,
		joinedAt: ts,
		role: 'host'
	}).run();

	return id;
}

export function getWatchSession(sessionId: string) {
	const db = getDb();
	const session = db.select().from(schema.watchSessions).where(eq(schema.watchSessions.id, sessionId)).get();
	if (!session) return null;

	const participants = db
		.select()
		.from(schema.sessionParticipants)
		.where(and(eq(schema.sessionParticipants.sessionId, sessionId), sql`left_at IS NULL`))
		.all();

	// Enrich participants
	const enriched = participants.map((p) => {
		const user = db.select({ username: schema.users.username, displayName: schema.users.displayName, avatar: schema.users.avatar })
			.from(schema.users).where(eq(schema.users.id, p.userId)).get();
		return { ...p, username: user?.username, displayName: user?.displayName, avatar: user?.avatar ?? null };
	});

	const invitedIds: string[] = session.invitedIds ? JSON.parse(session.invitedIds) : [];
	return { ...session, participants: enriched, invitedIds };
}

export function getActiveSessions(userId: string) {
	const db = getDb();
	const friendIds = getFriendIds(userId);
	const visibleIds = [...friendIds, userId];

	const sessions = db
		.select()
		.from(schema.watchSessions)
		.where(
			and(
				inArray(schema.watchSessions.hostId, visibleIds),
				sql`status != 'ended'`
			)
		)
		.orderBy(desc(schema.watchSessions.createdAt))
		.all();

	return sessions.map((s) => {
		const pCount = db.get<{ n: number }>(
			sql`SELECT COUNT(*) as n FROM session_participants WHERE session_id = ${s.id} AND left_at IS NULL`
		);
		const host = db.select({ username: schema.users.username, displayName: schema.users.displayName, avatar: schema.users.avatar })
			.from(schema.users).where(eq(schema.users.id, s.hostId)).get();
		const invitedIds: string[] = s.invitedIds ? JSON.parse(s.invitedIds) : [];
		return { ...s, participantCount: pCount?.n ?? 0, hostUsername: host?.username, hostDisplayName: host?.displayName, hostAvatar: host?.avatar ?? null, invitedIds };
	});
}

export function joinWatchSession(sessionId: string, userId: string): boolean {
	const db = getDb();
	const session = db.select().from(schema.watchSessions).where(eq(schema.watchSessions.id, sessionId)).get();
	if (!session || session.status === 'ended') return false;

	if (session.maxParticipants > 0) {
		const count = db.get<{ n: number }>(
			sql`SELECT COUNT(*) as n FROM session_participants WHERE session_id = ${sessionId} AND left_at IS NULL`
		);
		if ((count?.n ?? 0) >= session.maxParticipants) return false;
	}

	// Upsert: rejoin if left
	const existing = db.select().from(schema.sessionParticipants)
		.where(and(eq(schema.sessionParticipants.sessionId, sessionId), eq(schema.sessionParticipants.userId, userId)))
		.get();

	if (existing) {
		db.update(schema.sessionParticipants)
			.set({ leftAt: null, joinedAt: now() })
			.where(and(eq(schema.sessionParticipants.sessionId, sessionId), eq(schema.sessionParticipants.userId, userId)))
			.run();
	} else {
		db.insert(schema.sessionParticipants).values({
			sessionId,
			userId,
			joinedAt: now(),
			role: 'participant'
		}).run();
	}
	return true;
}

export function leaveWatchSession(sessionId: string, userId: string): boolean {
	const db = getDb();
	const result = db
		.update(schema.sessionParticipants)
		.set({ leftAt: now() })
		.where(and(
			eq(schema.sessionParticipants.sessionId, sessionId),
			eq(schema.sessionParticipants.userId, userId),
			sql`left_at IS NULL`
		))
		.run();
	return result.changes > 0;
}

export function updateWatchSessionStatus(sessionId: string, hostId: string, status: string): boolean {
	const db = getDb();
	const session = db.select().from(schema.watchSessions).where(eq(schema.watchSessions.id, sessionId)).get();
	if (!session || session.hostId !== hostId) return false;

	const updates: Record<string, unknown> = { status };
	if (status === 'ended') updates.endedAt = now();

	db.update(schema.watchSessions).set(updates).where(eq(schema.watchSessions.id, sessionId)).run();
	return true;
}

export function getSessionParticipantIds(sessionId: string): string[] {
	const db = getDb();
	return db
		.select({ userId: schema.sessionParticipants.userId })
		.from(schema.sessionParticipants)
		.where(and(eq(schema.sessionParticipants.sessionId, sessionId), sql`left_at IS NULL`))
		.all()
		.map((r) => r.userId);
}

export function addSessionMessage(sessionId: string, userId: string, content: string, type = 'text'): string {
	const db = getDb();
	const id = genId();
	db.insert(schema.sessionMessages).values({
		id,
		sessionId,
		userId,
		content,
		type,
		createdAt: now()
	}).run();
	return id;
}

export function getSessionMessages(sessionId: string, opts?: { limit?: number; before?: number }) {
	const db = getDb();
	const limit = opts?.limit ?? 100;

	const conditions = [eq(schema.sessionMessages.sessionId, sessionId)];
	if (opts?.before) {
		conditions.push(sql`created_at < ${opts.before}`);
	}

	const messages = db
		.select()
		.from(schema.sessionMessages)
		.where(and(...conditions))
		.orderBy(desc(schema.sessionMessages.createdAt))
		.limit(limit)
		.all();

	return messages.reverse().map((m) => {
		const user = db.select({ username: schema.users.username, displayName: schema.users.displayName, avatar: schema.users.avatar })
			.from(schema.users).where(eq(schema.users.id, m.userId)).get();
		return { ...m, username: user?.username, displayName: user?.displayName, avatar: user?.avatar ?? null };
	});
}

export function getActiveSessionForMedia(mediaId: string, serviceId: string) {
	const db = getDb();
	return db
		.select()
		.from(schema.watchSessions)
		.where(
			and(
				eq(schema.watchSessions.mediaId, mediaId),
				eq(schema.watchSessions.serviceId, serviceId),
				sql`status != 'ended'`
			)
		)
		.all();
}

// ── Collections ──────────────────────────────────────────────────────────

export function createCollection(creatorId: string, data: { name: string; description?: string; visibility?: string }): string {
	const db = getDb();
	const id = genId();
	const ts = now();

	db.insert(schema.collections).values({
		id,
		name: data.name,
		description: data.description ?? null,
		creatorId,
		visibility: data.visibility ?? 'private',
		createdAt: ts,
		updatedAt: ts
	}).run();

	// Creator is owner
	db.insert(schema.collectionMembers).values({
		collectionId: id,
		userId: creatorId,
		role: 'owner',
		addedAt: ts
	}).run();

	return id;
}

export function getCollection(collectionId: string, requestingUserId: string) {
	const db = getDb();
	const collection = db.select().from(schema.collections).where(eq(schema.collections.id, collectionId)).get();
	if (!collection) return null;

	// Check access
	const member = db.select().from(schema.collectionMembers)
		.where(and(eq(schema.collectionMembers.collectionId, collectionId), eq(schema.collectionMembers.userId, requestingUserId)))
		.get();

	if (!member) {
		if (collection.visibility === 'private') return null;
		if (collection.visibility === 'friends' && !areFriends(collection.creatorId, requestingUserId)) return null;
	}

	const items = db
		.select()
		.from(schema.collectionItems)
		.where(eq(schema.collectionItems.collectionId, collectionId))
		.orderBy(schema.collectionItems.position)
		.all();

	const members = db
		.select()
		.from(schema.collectionMembers)
		.where(eq(schema.collectionMembers.collectionId, collectionId))
		.all()
		.map((m) => {
			const user = db.select({ username: schema.users.username, displayName: schema.users.displayName })
				.from(schema.users).where(eq(schema.users.id, m.userId)).get();
			return { ...m, username: user?.username, displayName: user?.displayName };
		});

	return { ...collection, items, members, userRole: member?.role ?? null };
}

export function getUserCollections(userId: string) {
	const db = getDb();
	const memberships = db
		.select()
		.from(schema.collectionMembers)
		.where(eq(schema.collectionMembers.userId, userId))
		.all();

	if (memberships.length === 0) return [];

	const collectionIds = memberships.map((m) => m.collectionId);
	const collections = db
		.select()
		.from(schema.collections)
		.where(inArray(schema.collections.id, collectionIds))
		.orderBy(desc(schema.collections.updatedAt))
		.all();

	return collections.map((c) => {
		const itemCount = db.get<{ n: number }>(
			sql`SELECT COUNT(*) as n FROM collection_items WHERE collection_id = ${c.id}`
		);
		const memberCount = db.get<{ n: number }>(
			sql`SELECT COUNT(*) as n FROM collection_members WHERE collection_id = ${c.id}`
		);
		const posters = db
			.select({ mediaPoster: schema.collectionItems.mediaPoster })
			.from(schema.collectionItems)
			.where(eq(schema.collectionItems.collectionId, c.id))
			.orderBy(schema.collectionItems.position)
			.limit(4)
			.all()
			.map(p => p.mediaPoster)
			.filter(Boolean);
		const role = memberships.find((m) => m.collectionId === c.id)?.role;
		return { ...c, itemCount: itemCount?.n ?? 0, memberCount: memberCount?.n ?? 0, posters, userRole: role };
	});
}

export function updateCollection(collectionId: string, userId: string, updates: { name?: string; description?: string; visibility?: string }): boolean {
	const db = getDb();
	const member = db.select().from(schema.collectionMembers)
		.where(and(eq(schema.collectionMembers.collectionId, collectionId), eq(schema.collectionMembers.userId, userId)))
		.get();
	if (!member || member.role === 'viewer') return false;
	if (updates.visibility !== undefined && member.role !== 'owner') return false;

	const data: Record<string, unknown> = { updatedAt: now() };
	if (updates.name !== undefined) data.name = updates.name;
	if (updates.description !== undefined) data.description = updates.description;
	if (updates.visibility !== undefined) data.visibility = updates.visibility;

	db.update(schema.collections).set(data).where(eq(schema.collections.id, collectionId)).run();
	return true;
}

export function deleteCollection(collectionId: string, userId: string): boolean {
	const db = getDb();
	const collection = db.select().from(schema.collections).where(eq(schema.collections.id, collectionId)).get();
	if (!collection || collection.creatorId !== userId) return false;

	db.delete(schema.collectionItems).where(eq(schema.collectionItems.collectionId, collectionId)).run();
	db.delete(schema.collectionMembers).where(eq(schema.collectionMembers.collectionId, collectionId)).run();
	db.delete(schema.collections).where(eq(schema.collections.id, collectionId)).run();
	return true;
}

export function addCollectionItem(collectionId: string, userId: string, item: {
	mediaId: string;
	serviceId: string;
	mediaType: string;
	mediaTitle: string;
	mediaPoster?: string;
}): string | null {
	const db = getDb();
	const member = db.select().from(schema.collectionMembers)
		.where(and(eq(schema.collectionMembers.collectionId, collectionId), eq(schema.collectionMembers.userId, userId)))
		.get();
	if (!member || member.role === 'viewer') return null;

	const maxPos = db.get<{ m: number }>(
		sql`SELECT COALESCE(MAX(position), -1) as m FROM collection_items WHERE collection_id = ${collectionId}`
	);

	const id = genId();
	db.insert(schema.collectionItems).values({
		id,
		collectionId,
		mediaId: item.mediaId,
		serviceId: item.serviceId,
		mediaType: item.mediaType,
		mediaTitle: item.mediaTitle,
		mediaPoster: item.mediaPoster ?? null,
		addedBy: userId,
		position: (maxPos?.m ?? -1) + 1,
		createdAt: now()
	}).run();

	db.update(schema.collections).set({ updatedAt: now() }).where(eq(schema.collections.id, collectionId)).run();
	return id;
}

export function removeCollectionItem(collectionId: string, itemId: string, userId: string): boolean {
	const db = getDb();
	const member = db.select().from(schema.collectionMembers)
		.where(and(eq(schema.collectionMembers.collectionId, collectionId), eq(schema.collectionMembers.userId, userId)))
		.get();
	if (!member || member.role === 'viewer') return false;

	const result = db
		.delete(schema.collectionItems)
		.where(and(eq(schema.collectionItems.id, itemId), eq(schema.collectionItems.collectionId, collectionId)))
		.run();

	if (result.changes > 0) {
		db.update(schema.collections).set({ updatedAt: now() }).where(eq(schema.collections.id, collectionId)).run();
	}
	return result.changes > 0;
}

export function reorderCollectionItems(collectionId: string, userId: string, orderedIds: string[]): boolean {
	const db = getDb();
	const member = db.select().from(schema.collectionMembers)
		.where(and(eq(schema.collectionMembers.collectionId, collectionId), eq(schema.collectionMembers.userId, userId)))
		.get();
	if (!member || member.role === 'viewer') return false;

	for (let i = 0; i < orderedIds.length; i++) {
		db.update(schema.collectionItems)
			.set({ position: i })
			.where(and(eq(schema.collectionItems.id, orderedIds[i]), eq(schema.collectionItems.collectionId, collectionId)))
			.run();
	}
	db.update(schema.collections).set({ updatedAt: now() }).where(eq(schema.collections.id, collectionId)).run();
	return true;
}

export function addCollectionMember(collectionId: string, ownerId: string, targetUserId: string, role = 'editor'): boolean {
	const db = getDb();
	const member = db.select().from(schema.collectionMembers)
		.where(and(eq(schema.collectionMembers.collectionId, collectionId), eq(schema.collectionMembers.userId, ownerId)))
		.get();
	if (!member || member.role !== 'owner') return false;

	try {
		db.insert(schema.collectionMembers).values({
			collectionId,
			userId: targetUserId,
			role,
			addedAt: now()
		}).run();
		return true;
	} catch {
		// Already a member (unique constraint)
		return false;
	}
}

export function removeCollectionMember(collectionId: string, actingUserId: string, targetUserId: string): boolean {
	const db = getDb();

	// Self-leave: any non-owner member can remove themselves
	if (actingUserId === targetUserId) {
		const selfMember = db.select().from(schema.collectionMembers)
			.where(and(eq(schema.collectionMembers.collectionId, collectionId), eq(schema.collectionMembers.userId, actingUserId)))
			.get();
		if (!selfMember || selfMember.role === 'owner') return false; // owner can't leave
		const result = db.delete(schema.collectionMembers)
			.where(and(eq(schema.collectionMembers.collectionId, collectionId), eq(schema.collectionMembers.userId, actingUserId)))
			.run();
		return result.changes > 0;
	}

	// Owner removing others
	const member = db.select().from(schema.collectionMembers)
		.where(and(eq(schema.collectionMembers.collectionId, collectionId), eq(schema.collectionMembers.userId, actingUserId)))
		.get();
	if (!member || member.role !== 'owner') return false;

	const result = db
		.delete(schema.collectionMembers)
		.where(and(eq(schema.collectionMembers.collectionId, collectionId), eq(schema.collectionMembers.userId, targetUserId)))
		.run();
	return result.changes > 0;
}

// ── Session Invites & Voice ──────────────────────────────────────────

export function inviteToSession(sessionId: string, hostId: string, userIds: string[]): boolean {
	const db = getDb();
	const session = db.select().from(schema.watchSessions).where(eq(schema.watchSessions.id, sessionId)).get();
	if (!session || session.hostId !== hostId) return false;

	const existing: string[] = session.invitedIds ? JSON.parse(session.invitedIds) : [];
	const merged = [...new Set([...existing, ...userIds])];

	db.update(schema.watchSessions)
		.set({ invitedIds: JSON.stringify(merged) })
		.where(eq(schema.watchSessions.id, sessionId))
		.run();
	return true;
}

export function updateVoiceActive(sessionId: string, userId: string, active: boolean): boolean {
	const db = getDb();
	const result = db
		.update(schema.sessionParticipants)
		.set({ voiceActive: active })
		.where(and(
			eq(schema.sessionParticipants.sessionId, sessionId),
			eq(schema.sessionParticipants.userId, userId),
			sql`left_at IS NULL`
		))
		.run();
	return result.changes > 0;
}

// ── User Watchlist ───────────────────────────────────────────────────

export function getUserWatchlist(userId: string) {
	const db = getDb();
	return db
		.select()
		.from(schema.userWatchlist)
		.where(eq(schema.userWatchlist.userId, userId))
		.orderBy(schema.userWatchlist.position)
		.all();
}

export function addToWatchlist(userId: string, item: {
	mediaId: string;
	serviceId: string;
	mediaType: string;
	mediaTitle: string;
	mediaPoster?: string;
}): string | null {
	const db = getDb();

	// Check if already in watchlist
	const existing = db.select().from(schema.userWatchlist)
		.where(and(
			eq(schema.userWatchlist.userId, userId),
			eq(schema.userWatchlist.mediaId, item.mediaId),
			eq(schema.userWatchlist.serviceId, item.serviceId)
		))
		.get();
	if (existing) return existing.id;

	const maxPos = db.get<{ m: number }>(
		sql`SELECT COALESCE(MAX(position), -1) as m FROM user_watchlist WHERE user_id = ${userId}`
	);

	const id = genId();
	db.insert(schema.userWatchlist).values({
		id,
		userId,
		mediaId: item.mediaId,
		serviceId: item.serviceId,
		mediaType: item.mediaType,
		mediaTitle: item.mediaTitle,
		mediaPoster: item.mediaPoster ?? null,
		position: (maxPos?.m ?? -1) + 1,
		createdAt: now()
	}).run();
	return id;
}

export function removeFromWatchlist(userId: string, watchlistItemId: string): boolean {
	const db = getDb();
	const result = db
		.delete(schema.userWatchlist)
		.where(and(eq(schema.userWatchlist.id, watchlistItemId), eq(schema.userWatchlist.userId, userId)))
		.run();
	return result.changes > 0;
}

export function reorderWatchlist(userId: string, orderedIds: string[]): void {
	const db = getDb();
	for (let i = 0; i < orderedIds.length; i++) {
		db.update(schema.userWatchlist)
			.set({ position: i })
			.where(and(eq(schema.userWatchlist.id, orderedIds[i]), eq(schema.userWatchlist.userId, userId)))
			.run();
	}
}
