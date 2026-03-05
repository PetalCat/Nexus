import { json, error } from '@sveltejs/kit';
import { updateVoiceActive } from '$lib/server/social';
import type { RequestHandler } from './$types';

// PUT: Toggle voice active status
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401);
	const { active } = await request.json();
	if (typeof active !== 'boolean') throw error(400, 'active boolean required');
	const ok = updateVoiceActive(params.id, locals.user.id, active);
	if (!ok) throw error(404, 'Not in session');
	return json({ ok: true });
};
