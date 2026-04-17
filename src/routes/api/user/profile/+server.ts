import { json, error } from '@sveltejs/kit';
import { updateUser } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// CANONICAL: `/api/user/profile` owns editable profile fields — currently
// just displayName. Session-shape fields (id, username, isAdmin, presence,
// linkedServices) belong to GET /api/auth/me; playback prefs belong to
// POST /api/user/settings. Do NOT mirror identity fields here. See #33.

// PUT: Update display name
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401);

	const { displayName } = await request.json();
	if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
		throw error(400, 'displayName is required');
	}
	if (displayName.trim().length > 50) {
		throw error(400, 'displayName must be 50 characters or less');
	}

	updateUser(locals.user.id, { displayName: displayName.trim() });
	return json({ ok: true, displayName: displayName.trim() });
};
