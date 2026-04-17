import { json } from '@sveltejs/kit';
import { getPresence } from '$lib/server/social';
import { getUserCredentials } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// CANONICAL: `/api/auth/me` owns session identity — GET returns the read-only
// shape { user (id/username/displayName/avatar/isAdmin), presence, linkedServices }.
// Session-shape fields (identity + presence + linked creds) are sourced only
// from this endpoint. Editable profile fields (currently displayName) are
// mutated via PUT /api/user/profile; playback prefs via POST /api/user/settings.
// Do NOT add mutation verbs here. See #33.
//
// GET /api/auth/me — current user identity + presence + linked services
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const presence = getPresence(locals.user.id);
	const credentials = getUserCredentials(locals.user.id);

	return json({
		user: {
			id: locals.user.id,
			username: locals.user.username,
			displayName: locals.user.displayName,
			avatar: locals.user.avatar ?? null,
			isAdmin: locals.user.isAdmin
		},
		presence: presence
			? {
					status: presence.status,
					customStatus: presence.customStatus,
					ghostMode: presence.ghostMode === 1,
					currentActivity: presence.currentActivity ? JSON.parse(presence.currentActivity) : null,
					lastSeen: presence.lastSeen
				}
			: { status: 'offline', customStatus: null, ghostMode: false, currentActivity: null, lastSeen: null },
		linkedServices: credentials.map((c) => ({
			serviceId: c.serviceId,
			externalUsername: c.externalUsername,
			linkedAt: c.linkedAt
		}))
	});
};
