import { json, error } from '@sveltejs/kit';
import { getUserById, verifyPassword, changePassword } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// PUT: Change password
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);

	const { currentPassword, newPassword } = await request.json();
	if (!currentPassword || !newPassword) {
		throw error(400, 'currentPassword and newPassword are required');
	}
	if (typeof newPassword !== 'string' || newPassword.length < 6) {
		throw error(400, 'New password must be at least 6 characters');
	}

	const user = getUserById(locals.user.id);
	if (!user) throw error(404, 'User not found');

	// NOTE (BA cutover residual): this verifies + updates the legacy users.passwordHash.
	// Better Auth users keep their password in `accounts`, so this endpoint should be
	// re-routed through BA's change-password API (tracked follow-up). For null-hash
	// (BA/OIDC) users this fails closed — they cannot change a password they don't have here.
	if (!verifyPassword(currentPassword, user.passwordHash ?? '')) {
		throw error(403, 'Current password is incorrect');
	}

	changePassword(locals.user.id, newPassword);
	return json({ ok: true });
};
