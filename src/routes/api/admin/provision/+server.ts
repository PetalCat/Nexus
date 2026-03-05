import { json } from '@sveltejs/kit';
import { provisionUserOnServices } from '$lib/server/services';
import { getUserById } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/**
 * POST /api/admin/provision — Create accounts for a Nexus user on all user-linkable services.
 * Body: { userId: string, password: string }
 *
 * The password is needed because backend services (Jellyfin, etc.) require one
 * when creating an account. The admin typically sets a temporary one, or uses
 * the same password the user chose at registration.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Admin required' }, { status: 403 });

	const body = await request.json();
	const { userId, password } = body;

	if (!userId || !password) {
		return json({ error: 'Missing userId or password' }, { status: 400 });
	}

	const target = getUserById(userId);
	if (!target) return json({ error: 'User not found' }, { status: 404 });

	const results = await provisionUserOnServices(userId, target.username, password);
	return json({ results });
};
