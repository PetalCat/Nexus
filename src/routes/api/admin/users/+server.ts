import { json } from '@sveltejs/kit';
import { createUser, deleteUser, getAllUsers, updateUser } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// GET /api/admin/users — List all users
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });
	const users = getAllUsers();
	return json(users);
};

// POST /api/admin/users — Create a user (admin action)
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const body = await request.json();
	const { username, displayName, password, isAdmin } = body;

	if (!username || !displayName || !password) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}

	try {
		const id = createUser(username, displayName, password, isAdmin ?? false);
		return json({ id, username, displayName, isAdmin: isAdmin ?? false });
	} catch (e) {
		const msg = String(e);
		if (msg.includes('UNIQUE')) {
			return json({ error: 'Username already taken' }, { status: 409 });
		}
		return json({ error: 'Failed to create user' }, { status: 500 });
	}
};

// PATCH /api/admin/users — Update a user
export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const body = await request.json();
	const { id, displayName, isAdmin } = body;

	if (!id) return json({ error: 'Missing user id' }, { status: 400 });

	try {
		updateUser(id, { displayName, isAdmin });
		return json({ ok: true });
	} catch (e) {
		console.error('[API] user update error', e);
		return json({ error: 'Failed to update user' }, { status: 500 });
	}
};

// DELETE /api/admin/users?id=xxx — Delete a user
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Missing id parameter' }, { status: 400 });

	// Prevent self-deletion
	if (id === locals.user.id) {
		return json({ error: 'Cannot delete your own account' }, { status: 400 });
	}

	deleteUser(id);
	return json({ ok: true });
};
