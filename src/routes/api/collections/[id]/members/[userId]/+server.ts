import { json } from '@sveltejs/kit';
import { removeCollectionMember } from '$lib/server/social';
import type { RequestHandler } from './$types';

// DELETE /api/collections/:id/members/:userId — remove collaborator
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const ok = removeCollectionMember(params.id, locals.user.id, params.userId);
	if (!ok) return json({ error: 'Not owner or cannot remove' }, { status: 403 });

	return json({ ok: true });
};
