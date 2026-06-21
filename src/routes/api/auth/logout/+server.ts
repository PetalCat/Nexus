import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { COOKIE_NAME, deleteSession } from '$lib/server/auth';
import { auth } from '$lib/server/auth/better-auth';
import { getDb, schema } from '$lib/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	// Log the human out EVERYWHERE — both session systems, every session, both
	// cookies — so coexistence can't leave a live session behind (a BA cookie
	// whose Set-Cookie path doesn't ride this request, or a stale legacy row).
	const userId = locals.user?.id;
	const token = cookies.get(COOKIE_NAME);
	if (token) deleteSession(token);
	cookies.delete(COOKIE_NAME, { path: '/' });
	try {
		await auth.api.signOut({ headers: request.headers });
	} catch {
		// No active BA session (or already cleared) — nothing to revoke here.
	}
	// Belt-and-suspenders: clear the BA cookie unconditionally and revoke ALL of
	// this user's sessions in both tables (covers a session whose cookie wasn't
	// sent on this request).
	cookies.delete('better-auth.session_token', { path: '/' });
	if (userId) {
		const db = getDb();
		db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)).run();
		db.delete(schema.authSessions).where(eq(schema.authSessions.userId, userId)).run();
	}
	throw redirect(303, '/login');
};
