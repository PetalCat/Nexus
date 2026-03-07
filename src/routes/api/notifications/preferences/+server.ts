import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getNotificationPreferences,
	setNotificationPreferences,
	NOTIFICATION_TYPES
} from '$lib/server/notifications';

// GET /api/notifications/preferences — get user's notification preferences
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const preferences = getNotificationPreferences(locals.user.id);
	return json({ preferences, types: NOTIFICATION_TYPES });
};

// PUT /api/notifications/preferences — update notification preferences
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json();
	if (!body.preferences || typeof body.preferences !== 'object') {
		return json({ error: 'preferences object is required' }, { status: 400 });
	}
	// Validate that all keys are known notification types
	const validTypes = Object.keys(NOTIFICATION_TYPES);
	const prefs: Record<string, boolean> = {};
	for (const [key, val] of Object.entries(body.preferences)) {
		if (validTypes.includes(key) && typeof val === 'boolean') {
			prefs[key] = val;
		}
	}
	setNotificationPreferences(locals.user.id, prefs);
	return json({ ok: true, preferences: getNotificationPreferences(locals.user.id) });
};
