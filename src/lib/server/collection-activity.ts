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

	return entries.map((e) => {
		const user = db
			.select({
				username: schema.users.username,
				displayName: schema.users.displayName,
				avatar: schema.users.avatar
			})
			.from(schema.users)
			.where(eq(schema.users.id, e.userId))
			.get();
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

	const results: Array<{
		collectionId: string;
		collectionName: string;
		latestActivity: ActivityEntry;
		posters: string[];
	}> = [];

	for (const [colId, activity] of byCollection) {
		if (results.length >= limit) break;

		const collection = db
			.select()
			.from(schema.collections)
			.where(eq(schema.collections.id, colId))
			.get();
		if (!collection) continue;

		const user = db
			.select({
				username: schema.users.username,
				displayName: schema.users.displayName,
				avatar: schema.users.avatar
			})
			.from(schema.users)
			.where(eq(schema.users.id, activity.userId))
			.get();

		const posters = db
			.select({ mediaPoster: schema.collectionItems.mediaPoster })
			.from(schema.collectionItems)
			.where(eq(schema.collectionItems.collectionId, colId))
			.orderBy(schema.collectionItems.position)
			.limit(4)
			.all()
			.map((p) => p.mediaPoster)
			.filter(Boolean) as string[];

		results.push({
			collectionId: colId,
			collectionName: collection.name,
			latestActivity: {
				...activity,
				username: user?.username,
				displayName: user?.displayName,
				avatar: user?.avatar ?? null
			},
			posters
		});
	}

	return results;
}
