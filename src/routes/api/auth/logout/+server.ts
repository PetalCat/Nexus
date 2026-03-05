import { redirect } from '@sveltejs/kit';
import { COOKIE_NAME, deleteSession } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(COOKIE_NAME);
	if (token) deleteSession(token);
	cookies.delete(COOKIE_NAME, { path: '/' });
	throw redirect(303, '/login');
};
