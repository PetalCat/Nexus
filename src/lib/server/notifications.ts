import { randomBytes } from 'crypto';
import { and, eq, desc, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { broadcastToUser } from './ws';

function genId(): string {
	return randomBytes(16).toString('hex');
}

export interface CreateNotification {
	userId: string;
	type: string;
	title: string;
	message?: string;
	icon?: string;
	href?: string;
	actorId?: string;
	metadata?: Record<string, unknown>;
}

/** Create a notification, persist it, and push it via WebSocket */
export function createNotification(input: CreateNotification): string {
	const db = getDb();
	const id = genId();
	const now = Date.now();

	db.insert(schema.notifications).values({
		id,
		userId: input.userId,
		type: input.type,
		title: input.title,
		message: input.message ?? null,
		icon: input.icon ?? null,
		href: input.href ?? null,
		actorId: input.actorId ?? null,
		metadata: input.metadata ? JSON.stringify(input.metadata) : null,
		read: false,
		createdAt: now
	}).run();

	// Push to user via WebSocket
	broadcastToUser(input.userId, {
		type: 'notification:new',
		data: {
			id,
			type: input.type,
			title: input.title,
			message: input.message ?? null,
			icon: input.icon ?? null,
			href: input.href ?? null,
			actorId: input.actorId ?? null,
			metadata: input.metadata ?? null,
			read: false,
			createdAt: now
		}
	});

	return id;
}

/** Get notifications for a user, newest first */
export function getNotifications(userId: string, opts?: { limit?: number; offset?: number; unreadOnly?: boolean }) {
	const db = getDb();
	const limit = opts?.limit ?? 50;
	const offset = opts?.offset ?? 0;

	const conditions = [eq(schema.notifications.userId, userId)];
	if (opts?.unreadOnly) {
		conditions.push(eq(schema.notifications.read, false));
	}

	const rows = db
		.select()
		.from(schema.notifications)
		.where(and(...conditions))
		.orderBy(desc(schema.notifications.createdAt))
		.limit(limit)
		.offset(offset)
		.all();

	// Enrich with actor display name
	return rows.map((row) => {
		let actorName: string | null = null;
		if (row.actorId) {
			const actor = db.select({ displayName: schema.users.displayName })
				.from(schema.users).where(eq(schema.users.id, row.actorId)).get();
			actorName = actor?.displayName ?? null;
		}
		return {
			...row,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
			actorName
		};
	});
}

/** Count unread notifications */
export function getUnreadCount(userId: string): number {
	const db = getDb();
	const result = db.get<{ n: number }>(
		sql`SELECT COUNT(*) as n FROM notifications WHERE user_id = ${userId} AND read = 0`
	);
	return result?.n ?? 0;
}

/** Mark a single notification as read */
export function markRead(notificationId: string, userId: string): boolean {
	const db = getDb();
	const result = db
		.update(schema.notifications)
		.set({ read: true })
		.where(and(eq(schema.notifications.id, notificationId), eq(schema.notifications.userId, userId)))
		.run();
	return result.changes > 0;
}

/** Mark all notifications as read for a user */
export function markAllRead(userId: string): number {
	const db = getDb();
	const result = db
		.update(schema.notifications)
		.set({ read: true })
		.where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.read, false)))
		.run();
	return result.changes;
}

/** Delete a single notification */
export function deleteNotification(notificationId: string, userId: string): boolean {
	const db = getDb();
	const result = db
		.delete(schema.notifications)
		.where(and(eq(schema.notifications.id, notificationId), eq(schema.notifications.userId, userId)))
		.run();
	return result.changes > 0;
}

/** Delete all notifications for a user */
export function clearAllNotifications(userId: string): number {
	const db = getDb();
	const result = db
		.delete(schema.notifications)
		.where(eq(schema.notifications.userId, userId))
		.run();
	return result.changes;
}

/** Prune old read notifications (older than 30 days) */
export function pruneOldNotifications(): number {
	const db = getDb();
	const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
	const result = db
		.delete(schema.notifications)
		.where(and(eq(schema.notifications.read, true), sql`created_at < ${cutoff}`))
		.run();
	return result.changes;
}

// ── Notification Types ──────────────────────────────────────────

export const NOTIFICATION_TYPES = {
	friend_request: { label: 'Friend requests', description: 'When someone sends you a friend request' },
	friend_accept: { label: 'Friend accepted', description: 'When someone accepts your friend request' },
	share_received: { label: 'Shared media', description: 'When someone shares media with you' },
	session_invite: { label: 'Session invites', description: 'When you\'re invited to a watch/listen party' },
	request_approved: { label: 'Request approved', description: 'When your media request is approved' },
	request_available: { label: 'Request available', description: 'When requested media becomes available' },
	video_subscription: { label: 'Video subscriptions', description: 'New uploads from subscribed channels' },
	system: { label: 'System', description: 'System announcements and updates' }
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

// ── Notification Preferences ────────────────────────────────────

/** Get all notification preferences for a user (returns map of type -> enabled) */
export function getNotificationPreferences(userId: string): Record<string, boolean> {
	const db = getDb();
	const rows = db
		.select()
		.from(schema.notificationPreferences)
		.where(eq(schema.notificationPreferences.userId, userId))
		.all();

	const prefs: Record<string, boolean> = {};
	// Default all types to enabled
	for (const key of Object.keys(NOTIFICATION_TYPES)) {
		prefs[key] = true;
	}
	// Override with user's saved preferences
	for (const row of rows) {
		prefs[row.notificationType] = row.enabled;
	}
	return prefs;
}

/** Check if a specific notification type is enabled for a user */
export function isNotificationEnabled(userId: string, type: string): boolean {
	const db = getDb();
	const row = db
		.select({ enabled: schema.notificationPreferences.enabled })
		.from(schema.notificationPreferences)
		.where(and(
			eq(schema.notificationPreferences.userId, userId),
			eq(schema.notificationPreferences.notificationType, type)
		))
		.get();
	// Default to enabled if no preference set
	return row?.enabled ?? true;
}

/** Set a notification preference for a user */
export function setNotificationPreference(userId: string, type: string, enabled: boolean): void {
	const db = getDb();
	const now = Date.now();
	db.run(
		sql`INSERT INTO notification_preferences (user_id, notification_type, enabled, updated_at)
			VALUES (${userId}, ${type}, ${enabled ? 1 : 0}, ${now})
			ON CONFLICT(user_id, notification_type)
			DO UPDATE SET enabled = ${enabled ? 1 : 0}, updated_at = ${now}`
	);
}

/** Set multiple notification preferences at once */
export function setNotificationPreferences(userId: string, prefs: Record<string, boolean>): void {
	for (const [type, enabled] of Object.entries(prefs)) {
		setNotificationPreference(userId, type, enabled);
	}
}

/** Create a notification, but only if the user has it enabled */
export function createNotificationIfEnabled(input: CreateNotification): string | null {
	if (!isNotificationEnabled(input.userId, input.type)) {
		return null;
	}
	return createNotification(input);
}
