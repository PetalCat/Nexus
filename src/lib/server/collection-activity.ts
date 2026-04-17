import { randomBytes } from 'crypto';
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';

function genId(): string {
	return randomBytes(16).toString('hex');
}

function now(): number {
	return Date.now();
}

export interface ActivityEntry {
	id: string;
	collectionId: string;
	userId: string;
	action: string;
	targetTitle: string | null;
	targetMediaId: string | null;
	createdAt: number;
	username?: string;
	displayName?: string;
	avatar?: string | null;
}

export function logActivity(
	collectionId: string,
	userId: string,
	action: string,
	opts?: { targetTitle?: string; targetMediaId?: string }
): string {
	const db = getDb();
	const id = genId();
	db.insert(schema.collectionActivity).values({
		id,
		collectionId,
		userId,
		action,
		targetTitle: opts?.targetTitle ?? null,
		targetMediaId: opts?.targetMediaId ?? null,
		createdAt: now()
	}).run();
	return id;
}

export function getCollectionActivity(
	collectionId: string,
	opts?: { limit?: number; offset?: number }
): ActivityEntry[] {
	const db = getDb();
	const limit = opts?.limit ?? 20;
	const offset = opts?.offset ?? 0;

	const entries = db
		.select()
		.from(schema.collectionActivity)
		.where(eq(schema.collectionActivity.collectionId, collectionId))
		.orderBy(desc(schema.collectionActivity.createdAt))
		.limit(limit)
		.offset(offset)
		.all();

	if (entries.length === 0) return [];

	// Batch user lookup (was 1 per entry).
	const userIds = Array.from(new Set(entries.map((e) => e.userId)));
	const users = db
		.select({
			id: schema.users.id,
			username: schema.users.username,
			displayName: schema.users.displayName,
			avatar: schema.users.avatar
		})
		.from(schema.users)
		.where(inArray(schema.users.id, userIds))
		.all();
	const userMap = new Map(users.map((u) => [u.id, u]));

	return entries.map((e) => {
		const user = userMap.get(e.userId);
		return {
			...e,
			username: user?.username,
			displayName: user?.displayName,
			avatar: user?.avatar ?? null
		};
	});
}

export function getRecentCollectionUpdates(
	userId: string,
	opts?: { days?: number; limit?: number }
): Array<{
	collectionId: string;
	collectionName: string;
	latestActivity: ActivityEntry;
	posters: string[];
}> {
	const db = getDb();
	const days = opts?.days ?? 7;
	const limit = opts?.limit ?? 10;
	const since = Date.now() - days * 24 * 60 * 60 * 1000;

	// Get collections user is a member of
	const memberships = db
		.select({ collectionId: schema.collectionMembers.collectionId })
		.from(schema.collectionMembers)
		.where(eq(schema.collectionMembers.userId, userId))
		.all();

	if (memberships.length === 0) return [];

	const collectionIds = memberships.map((m) => m.collectionId);

	// Get recent activity in those collections
	const activities = db
		.select()
		.from(schema.collectionActivity)
		.where(
			and(
				inArray(schema.collectionActivity.collectionId, collectionIds),
				sql`created_at >= ${since}`
			)
		)
		.orderBy(desc(schema.collectionActivity.createdAt))
		.all();

	// Group by collection, take latest per collection
	const byCollection = new Map<string, typeof activities[0]>();
	for (const a of activities) {
		if (!byCollection.has(a.collectionId)) {
			byCollection.set(a.collectionId, a);
		}
	}

	const orderedEntries = Array.from(byCollection.entries()).slice(0, limit);
	if (orderedEntries.length === 0) return [];

	const neededColIds = orderedEntries.map(([id]) => id);
	const neededUserIds = Array.from(new Set(orderedEntries.map(([, a]) => a.userId)));

	// Batch: collections, users, posters (was 3 queries per entry).
	const collectionRows = db
		.select()
		.from(schema.collections)
		.where(inArray(schema.collections.id, neededColIds))
		.all();
	const collectionMap = new Map(collectionRows.map((c) => [c.id, c]));

	const userRows = db
		.select({
			id: schema.users.id,
			username: schema.users.username,
			displayName: schema.users.displayName,
			avatar: schema.users.avatar
		})
		.from(schema.users)
		.where(inArray(schema.users.id, neededUserIds))
		.all();
	const userMap = new Map(userRows.map((u) => [u.id, u]));

	const posterRows = db
		.select({
			collectionId: schema.collectionItems.collectionId,
			mediaPoster: schema.collectionItems.mediaPoster,
			position: schema.collectionItems.position
		})
		.from(schema.collectionItems)
		.where(inArray(schema.collectionItems.collectionId, neededColIds))
		.orderBy(schema.collectionItems.collectionId, schema.collectionItems.position)
		.all();
	const posterMap = new Map<string, string[]>();
	for (const row of posterRows) {
		if (!row.mediaPoster) continue;
		const arr = posterMap.get(row.collectionId) ?? [];
		if (arr.length < 4) {
			arr.push(row.mediaPoster);
			posterMap.set(row.collectionId, arr);
		}
	}

	const results: Array<{
		collectionId: string;
		collectionName: string;
		latestActivity: ActivityEntry;
		posters: string[];
	}> = [];
	for (const [colId, activity] of orderedEntries) {
		const collection = collectionMap.get(colId);
		if (!collection) continue;
		const user = userMap.get(activity.userId);
		results.push({
			collectionId: colId,
			collectionName: collection.name,
			latestActivity: {
				...activity,
				username: user?.username,
				displayName: user?.displayName,
				avatar: user?.avatar ?? null
			},
			posters: posterMap.get(colId) ?? []
		});
	}

	return results;
}
