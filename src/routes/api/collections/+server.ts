import { json } from '@sveltejs/kit';
import { getUserCollections, createCollection } from '$lib/server/social';
import type { RequestHandler } from './$types';

// GET /api/collections — list collections I'm part of
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const collections = getUserCollections(locals.user.id);
	return json({ collections });
};

// POST /api/collections — create a new collection
// Body: { name, description?, visibility? }
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { name, description, visibility } = body;

	if (!name || typeof name !== 'string') {
		return json({ error: 'Missing name' }, { status: 400 });
	}

	const validVisibility = ['private', 'friends', 'public'];
	if (visibility && !validVisibility.includes(visibility)) {
		return json({ error: 'Invalid visibility' }, { status: 400 });
	}

	const id = createCollection(locals.user.id, { name, description, visibility });
	return json({ id });
};
