import { json } from '@sveltejs/kit';
import { addCollectionMember } from '$lib/server/social';
import type { RequestHandler } from './$types';

// POST /api/collections/:id/members — add collaborator
// Body: { userId, role?: 'editor' | 'viewer' }
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { userId, role } = body;

	if (!userId) return json({ error: 'Missing userId' }, { status: 400 });

	const validRoles = ['editor', 'viewer'];
	if (role && !validRoles.includes(role)) {
		return json({ error: 'Invalid role' }, { status: 400 });
	}

	const ok = addCollectionMember(params.id, locals.user.id, userId, role ?? 'editor');
	if (!ok) return json({ error: 'Not owner or already a member' }, { status: 403 });

	return json({ ok: true });
};
