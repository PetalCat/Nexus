import { json } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import { provisionUserOnServices } from '$lib/server/services';
import { getUserById } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/**
 * POST /api/admin/provision — Create accounts for a Nexus user on all user-linkable services.
 * Body: { userId: string, password?: string }
 *
 * If no password is provided, a random one is generated. The user authenticates
 * via Nexus (which proxies to the service), so the password doesn't need to be known.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Admin required' }, { status: 403 });

	const body = await request.json();
	const { userId } = body;

	if (!userId) {
		return json({ error: 'Missing userId' }, { status: 400 });
	}

	const target = getUserById(userId);
	if (!target) return json({ error: 'User not found' }, { status: 404 });

	const password = body.password || randomBytes(24).toString('base64url');
	const results = await provisionUserOnServices(userId, target.username, password);
	return json({ results });
};
