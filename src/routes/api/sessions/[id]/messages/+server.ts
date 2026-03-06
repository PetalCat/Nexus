import { json } from '@sveltejs/kit';
import { getSessionMessages, addSessionMessage, getSessionParticipantIds } from '$lib/server/social';
import { broadcastToUsers } from '$lib/server/ws';
import type { RequestHandler } from './$types';

// GET /api/sessions/:id/messages?limit=100&before=timestamp
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const limit = parseInt(url.searchParams.get('limit') ?? '100');
	const beforeStr = url.searchParams.get('before');
	const before = beforeStr ? parseInt(beforeStr) : undefined;

	const messages = getSessionMessages(params.id, { limit, before });
	return json({ messages });
};

// POST /api/sessions/:id/messages — send chat message
// Body: { content: string, type?: 'text' | 'reaction' }
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { content, type } = body;

	if (!content || typeof content !== 'string') {
		return json({ error: 'Missing content' }, { status: 400 });
	}

	const msgType = type === 'reaction' ? 'reaction' : 'text';
	const msgId = addSessionMessage(params.id, locals.user.id, content, msgType);

	// Broadcast to session participants
	const participantIds = getSessionParticipantIds(params.id);
	broadcastToUsers(participantIds, {
		type: 'session:message',
		data: {
			sessionId: params.id,
			messageId: msgId,
			userId: locals.user.id,
			username: locals.user.username,
			displayName: locals.user.displayName,
			content,
			messageType: msgType,
			createdAt: Date.now()
		}
	}, locals.user.id);

	return json({ id: msgId });
};
