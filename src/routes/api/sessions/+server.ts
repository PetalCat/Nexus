import { json } from '@sveltejs/kit';
import { getActiveSessions, createWatchSession, getSessionParticipantIds } from '$lib/server/social';
import { broadcastToUsers } from '$lib/server/ws';
import type { RequestHandler } from './$types';

// GET /api/sessions — list active sessions (friends only)
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const sessions = getActiveSessions(locals.user.id);
	return json({ sessions });
};

// POST /api/sessions — create a new session
// Body: { type, mediaId, serviceId, mediaTitle, mediaType, maxParticipants? }
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { type, mediaId, serviceId, mediaTitle, mediaType, maxParticipants } = body;

	if (!type || !mediaId || !serviceId || !mediaTitle || !mediaType) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}

	const validTypes = ['watch_party', 'netplay', 'listen_along'];
	if (!validTypes.includes(type)) {
		return json({ error: 'Invalid session type' }, { status: 400 });
	}

	const id = createWatchSession(locals.user.id, { type, mediaId, serviceId, mediaTitle, mediaType, maxParticipants });

	return json({ id });
};
