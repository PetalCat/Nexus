import { json, error } from '@sveltejs/kit';
import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

const ALLOWED_KEYS = ['autoplayTrailers', 'autoplayNext'];

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);
	const { key, value } = await request.json();
	if (!ALLOWED_KEYS.includes(key)) throw error(400, 'Invalid setting key');

	const db = getDb();
	const fullKey = `user:${locals.user.id}:${key}`;

	const existing = db
		.select()
		.from(schema.appSettings)
		.where(eq(schema.appSettings.key, fullKey))
		.get();

	if (existing) {
		db.update(schema.appSettings)
			.set({ value: String(value) })
			.where(eq(schema.appSettings.key, fullKey))
			.run();
	} else {
		db.insert(schema.appSettings)
			.values({ key: fullKey, value: String(value) })
			.run();
	}

	return json({ ok: true });
};
