import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { saveMetadata } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/** GET — list all save metadata for this game's service */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');

	const db = getDb();
	const rows = db
		.select()
		.from(saveMetadata)
		.where(
			and(
				eq(saveMetadata.userId, locals.user.id),
				eq(saveMetadata.serviceId, serviceId)
			)
		)
		.all();

	// Return as a map: { "state:123": { label, pinned }, ... }
	const map: Record<string, { label: string | null; pinned: boolean }> = {};
	for (const r of rows) {
		map[`${r.entryType}:${r.entryId}`] = { label: r.label, pinned: r.pinned };
	}
	return json(map);
};

/** PATCH — upsert label/pinned for a single entry */
export const PATCH: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) throw error(401);
	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');

	const body = await request.json();
	const { entryId, entryType, label, pinned } = body as {
		entryId: number;
		entryType: 'save' | 'state';
		label?: string | null;
		pinned?: boolean;
	};

	if (!entryId || !entryType) throw error(400, 'entryId and entryType required');

	const db = getDb();
	const now = Date.now();

	// Upsert
	const existing = db
		.select()
		.from(saveMetadata)
		.where(
			and(
				eq(saveMetadata.userId, locals.user.id),
				eq(saveMetadata.serviceId, serviceId),
				eq(saveMetadata.entryId, entryId),
				eq(saveMetadata.entryType, entryType)
			)
		)
		.get();

	if (existing) {
		db.update(saveMetadata)
			.set({
				...(label !== undefined ? { label } : {}),
				...(pinned !== undefined ? { pinned } : {}),
				updatedAt: now
			})
			.where(eq(saveMetadata.id, existing.id))
			.run();
	} else {
		db.insert(saveMetadata)
			.values({
				userId: locals.user.id,
				serviceId,
				entryId,
				entryType,
				label: label ?? null,
				pinned: pinned ?? false,
				updatedAt: now
			})
			.run();
	}

	return json({ ok: true });
};
