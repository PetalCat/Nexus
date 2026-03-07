import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { playbackSpeedRules } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/** GET: Fetch all speed rules for the current user */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401);
	const db = getDb();
	const rules = db
		.select()
		.from(playbackSpeedRules)
		.where(eq(playbackSpeedRules.userId, locals.user.id))
		.all();
	return json({ rules });
};

/** POST: Upsert a speed rule */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);

	const { scope, scopeValue, scopeName, speed } = await request.json() as {
		scope: string;
		scopeValue?: string | null;
		scopeName?: string | null;
		speed: number;
	};

	if (!scope || !['default', 'type', 'channel', 'video'].includes(scope)) {
		throw error(400, 'scope must be default, type, channel, or video');
	}
	if (typeof speed !== 'number' || speed <= 0 || speed > 16) {
		throw error(400, 'speed must be >0 and <=16');
	}

	const db = getDb();
	const userId = locals.user.id;
	const now = Date.now();
	const sv = scopeValue ?? null;

	// Upsert: try update first, insert if not found
	const existing = db
		.select()
		.from(playbackSpeedRules)
		.where(
			and(
				eq(playbackSpeedRules.userId, userId),
				eq(playbackSpeedRules.scope, scope),
				sv !== null ? eq(playbackSpeedRules.scopeValue, sv) : undefined
			)
		)
		.get();

	if (existing) {
		db.update(playbackSpeedRules)
			.set({ speed, scopeName: scopeName ?? existing.scopeName, updatedAt: now })
			.where(eq(playbackSpeedRules.id, existing.id))
			.run();
		return json({ id: existing.id, updated: true });
	} else {
		const result = db.insert(playbackSpeedRules).values({
			userId,
			scope,
			scopeValue: sv,
			scopeName: scopeName ?? null,
			speed,
			updatedAt: now
		}).run();
		return json({ id: result.lastInsertRowid, updated: false });
	}
};

/** DELETE: Remove a speed rule by id, or by scope+scopeValue */
export const DELETE: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401);
	const db = getDb();
	const userId = locals.user.id;

	const id = url.searchParams.get('id');
	if (id) {
		const rule = db.select().from(playbackSpeedRules)
			.where(and(eq(playbackSpeedRules.id, Number(id)), eq(playbackSpeedRules.userId, userId)))
			.get();
		if (!rule) throw error(404, 'Rule not found');
		db.delete(playbackSpeedRules).where(eq(playbackSpeedRules.id, Number(id))).run();
		return json({ ok: true });
	}

	const scope = url.searchParams.get('scope');
	const scopeValue = url.searchParams.get('scopeValue');
	if (!scope) throw error(400, 'id or scope required');

	const conditions = [
		eq(playbackSpeedRules.userId, userId),
		eq(playbackSpeedRules.scope, scope)
	];
	if (scopeValue) conditions.push(eq(playbackSpeedRules.scopeValue, scopeValue));

	db.delete(playbackSpeedRules).where(and(...conditions)).run();
	return json({ ok: true });
};
