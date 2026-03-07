import { json } from '@sveltejs/kit';
import { getRawDb } from '$lib/db';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const raw = getRawDb();
	const profiles = raw.prepare(
		`SELECT id, name, is_default, config, created_at, updated_at FROM user_rec_profiles
		 WHERE user_id = ? ORDER BY is_default DESC, created_at ASC`
	).all(user.id) as Array<{
		id: string;
		name: string;
		is_default: number;
		config: string;
		created_at: number;
		updated_at: number;
	}>;

	return json({
		profiles: profiles.map((p) => ({
			id: p.id,
			name: p.name,
			isDefault: !!p.is_default,
			config: JSON.parse(p.config),
			createdAt: p.created_at,
			updatedAt: p.updated_at
		}))
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { name, config } = body as { name?: string; config?: Record<string, unknown> };

	if (!name || !config) {
		return json({ error: 'name and config are required' }, { status: 400 });
	}

	const raw = getRawDb();
	const now = Date.now();
	const id = crypto.randomUUID();

	raw.prepare(
		`INSERT INTO user_rec_profiles (id, user_id, name, is_default, config, created_at, updated_at)
		 VALUES (?, ?, ?, 0, ?, ?, ?)`
	).run(id, user.id, name, JSON.stringify(config), now, now);

	return json({ id, name });
};
