import { json } from '@sveltejs/kit';
import { createInviteLink, deleteInviteLink, getInviteLinks } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// GET /api/admin/invites — List all invite links
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });
	const invites = getInviteLinks();
	return json(invites);
};

// POST /api/admin/invites — Create a new invite link
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const body = await request.json().catch(() => ({}));
	const maxUses = body.maxUses ?? 1;
	const expiresInHours = body.expiresInHours ?? null;

	const code = createInviteLink(locals.user.id, {
		maxUses,
		expiresInHours: expiresInHours ?? undefined
	});

	return json({ code, maxUses, expiresInHours });
};

// DELETE /api/admin/invites?code=xxx — Delete an invite link
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const code = url.searchParams.get('code');
	if (!code) return json({ error: 'Missing code parameter' }, { status: 400 });

	deleteInviteLink(code);
	return json({ ok: true });
};
