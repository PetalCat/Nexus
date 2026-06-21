import { json, error } from '@sveltejs/kit';
import { auth } from '$lib/server/auth/better-auth';
import type { RequestHandler } from './$types';

// PUT: Change password — routed through Better Auth so the new password lands in
// the `accounts` row that BA login actually verifies against. (The old code wrote
// the legacy users.passwordHash, which BA login ignores, so a change never took
// effect for migrated/BA users.) BA verifies the current password via the
// dual-format verify shim (legacy scrypt OR BA scrypt), then rehashes to BA's
// format. Service-auth users (no BA credential account) correctly can't change a
// password they don't have here — they authenticate via their external service.
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);

	const { currentPassword, newPassword } = await request.json();
	if (!currentPassword || !newPassword) {
		throw error(400, 'currentPassword and newPassword are required');
	}
	if (typeof newPassword !== 'string' || newPassword.length < 6) {
		throw error(400, 'New password must be at least 6 characters');
	}

	try {
		await auth.api.changePassword({
			body: { currentPassword, newPassword },
			headers: request.headers
		});
	} catch {
		// BA throws on an incorrect current password, a missing credential account,
		// or a policy failure. Don't leak which — treat as a rejected change.
		throw error(403, 'Current password is incorrect');
	}

	return json({ ok: true });
};
