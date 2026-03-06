import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addCollaborator, removeCollaborator } from '$lib/server/music';

/**
 * POST /api/music/playlists/[id]/collaborators — add a collaborator
 * Body: { userId: string, role?: 'editor' | 'viewer' }
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const collaboratorUserId = body.userId;
	const role = body.role === 'viewer' ? 'viewer' : 'editor';

	if (!collaboratorUserId || typeof collaboratorUserId !== 'string') {
		return json({ error: 'userId is required' }, { status: 400 });
	}

	const ok = addCollaborator(params.id, locals.user.id, collaboratorUserId, role);
	if (!ok) return json({ error: 'Playlist not found or not owned by you' }, { status: 403 });

	return json({ ok: true });
};

/**
 * DELETE /api/music/playlists/[id]/collaborators — remove a collaborator
 * Body: { userId: string }
 */
export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const collaboratorUserId = body.userId;

	if (!collaboratorUserId || typeof collaboratorUserId !== 'string') {
		return json({ error: 'userId is required' }, { status: 400 });
	}

	const ok = removeCollaborator(params.id, locals.user.id, collaboratorUserId);
	if (!ok) return json({ error: 'Playlist not found or not owned by you' }, { status: 403 });

	return json({ ok: true });
};
