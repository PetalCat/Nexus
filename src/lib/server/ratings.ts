import { randomBytes } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { withCache, invalidate } from './cache';
import { emitMediaAction } from './analytics';

function genId(): string {
	return randomBytes(16).toString('hex');
}

export function getUserRating(
	userId: string,
	mediaId: string,
	serviceId: string
): number | null {
	const db = getDb();
	const row = db
		.select({ rating: schema.userRatings.rating })
		.from(schema.userRatings)
		.where(
			and(
				eq(schema.userRatings.userId, userId),
				eq(schema.userRatings.mediaId, mediaId),
				eq(schema.userRatings.serviceId, serviceId)
			)
		)
		.get();
	return row?.rating ?? null;
}

export function upsertRating(
	userId: string,
	mediaId: string,
	serviceId: string,
	rating: number,
	meta: { mediaType: string; serviceType: string }
): void {
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
		throw new Error('Rating must be an integer between 1 and 5');
	}

	const db = getDb();
	const now = Date.now();
	const existing = db
		.select({ id: schema.userRatings.id })
		.from(schema.userRatings)
		.where(
			and(
				eq(schema.userRatings.userId, userId),
				eq(schema.userRatings.mediaId, mediaId),
				eq(schema.userRatings.serviceId, serviceId)
			)
		)
		.get();

	if (existing) {
		db.update(schema.userRatings)
			.set({ rating, updatedAt: now })
			.where(eq(schema.userRatings.id, existing.id))
			.run();
	} else {
		db.insert(schema.userRatings)
			.values({
				id: genId(),
				userId,
				mediaId,
				serviceId,
				mediaType: meta.mediaType,
				rating,
				createdAt: now,
				updatedAt: now
			})
			.run();
	}

	invalidate(`rating-stats:${mediaId}:${serviceId}`);

	emitMediaAction({
		userId,
		serviceId,
		serviceType: meta.serviceType,
		actionType: 'rate',
		mediaId,
		mediaType: meta.mediaType,
		metadata: { rating }
	});
}

export function deleteRating(
	userId: string,
	mediaId: string,
	serviceId: string,
	meta: { serviceType: string; mediaType: string }
): boolean {
	const db = getDb();
	const result = db
		.delete(schema.userRatings)
		.where(
			and(
				eq(schema.userRatings.userId, userId),
				eq(schema.userRatings.mediaId, mediaId),
				eq(schema.userRatings.serviceId, serviceId)
			)
		)
		.run();

	invalidate(`rating-stats:${mediaId}:${serviceId}`);

	emitMediaAction({
		userId,
		serviceId,
		serviceType: meta.serviceType,
		actionType: 'rate',
		mediaId,
		mediaType: meta.mediaType,
		metadata: { cleared: true }
	});

	return result.changes > 0;
}

export async function getMediaRatingStats(
	mediaId: string,
	serviceId: string
): Promise<{ avg: number; count: number } | null> {
	return withCache(`rating-stats:${mediaId}:${serviceId}`, 2 * 60 * 1000, async () => {
		const db = getDb();
		const row = db
			.get<{ avg: number | null; count: number }>(
				sql`SELECT AVG(rating) as avg, COUNT(*) as count FROM user_ratings WHERE media_id = ${mediaId} AND service_id = ${serviceId}`
			);
		if (!row || row.count === 0) return null;
		return { avg: Math.round(row.avg! * 10) / 10, count: row.count };
	});
}
