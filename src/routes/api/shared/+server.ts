import { json } from '@sveltejs/kit';
import { getSharedItems, shareItem, markSharedSeen, areFriends } from '$lib/server/social';
import { broadcastToUser } from '$lib/server/ws';
import type { RequestHandler } from './$types';

// GET /api/shared?limit=50&offset=0&unseenOnly=false
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const limit = parseInt(url.searchParams.get('limit') ?? '50');
	const offset = parseInt(url.searchParams.get('offset') ?? '0');
	const unseenOnly = url.searchParams.get('unseenOnly') === 'true';

	const items = getSharedItems(locals.user.id, { limit, offset, unseenOnly });
	return json({ items });
};

// POST /api/shared — share media with friend(s)
// Body: { userIds|toUserIds: string[], mediaId, serviceId, mediaType, mediaTitle, mediaPoster?, message? }
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { mediaId, serviceId, mediaType, mediaTitle, mediaPoster, message } = body;
	// Accept both "userIds" (MediaUI convention) and "toUserIds"
	const toUserIds: string[] = body.userIds ?? body.toUserIds ?? [];

	if (!Array.isArray(toUserIds) || toUserIds.length === 0 || !mediaId || !serviceId || !mediaType || !mediaTitle) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}

	// Verify all recipients are friends
	for (const toId of toUserIds) {
		if (!areFriends(locals.user.id, toId)) {
			return json({ error: `Not friends with user ${toId}` }, { status: 403 });
		}
	}

	const ids = shareItem(locals.user.id, toUserIds, { mediaId, serviceId, mediaType, mediaTitle, mediaPoster, message });

	// Notify recipients via WS
	for (const toId of toUserIds) {
		broadcastToUser(toId, {
			type: 'presence:notification',
			data: {
				notificationType: 'share_received',
				fromUserId: locals.user.id,
				fromUsername: locals.user.username,
				fromDisplayName: locals.user.displayName,
				mediaTitle,
				mediaType
			}
		});
	}

	return json({ ok: true, ids });
};

// PATCH /api/shared — mark a shared item as seen
// Body: { shareId: string }
export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { shareId } = body;
	if (!shareId) return json({ error: 'Missing shareId' }, { status: 400 });

	const ok = markSharedSeen(shareId, locals.user.id);
	if (!ok) return json({ error: 'Not found' }, { status: 404 });

	return json({ ok: true });
};
