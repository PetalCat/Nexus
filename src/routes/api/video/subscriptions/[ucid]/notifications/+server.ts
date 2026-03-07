import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	isChannelNotifyEnabled,
	enableChannelNotify,
	disableChannelNotify
} from '$lib/server/video-notifications';

// GET — check if notifications are enabled for this channel
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const enabled = isChannelNotifyEnabled(locals.user.id, params.ucid);
	return json({ enabled });
};

// POST — enable notifications for this channel
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => ({}));
	const channelName = body.channelName ?? params.ucid;
	enableChannelNotify(locals.user.id, params.ucid, channelName);
	return json({ ok: true, enabled: true });
};

// DELETE — disable notifications for this channel
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	disableChannelNotify(locals.user.id, params.ucid);
	return json({ ok: true, enabled: false });
};
