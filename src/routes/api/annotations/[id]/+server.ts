import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteAnnotation } from '$lib/server/annotations';

// DELETE /api/annotations/<id> — "ack & remove". Collaborative: any signed-in
// user can clear a note (the hooks API gate already requires a session).
export const DELETE: RequestHandler = ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const id = Number(params.id);
	if (!Number.isInteger(id)) throw error(400, 'bad id');
	return json({ ok: deleteAnnotation(id) });
};
