import { redirect, type Handle } from '@sveltejs/kit';
import { COOKIE_NAME, getUserCount, validateSession } from '$lib/server/auth';
import { startSessionPoller } from '$lib/server/session-poller';
import { startStatsScheduler } from '$lib/server/stats-scheduler';

// Start background analytics
startSessionPoller();
startStatsScheduler();

/** Paths that never require auth (login/setup flows) */
const NO_AUTH_PATHS = ['/login', '/setup', '/invite', '/api/ingest/webhook'];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	// Always allow pre-auth paths through without session checks
	if (NO_AUTH_PATHS.some((p) => path.startsWith(p))) {
		return resolve(event);
	}

	// First-run: no users yet → must set up an account
	const userCount = getUserCount();
	if (userCount === 0) {
		throw redirect(303, '/setup');
	}

	// Validate session cookie
	const token = event.cookies.get(COOKIE_NAME);
	const user = validateSession(token);

	if (user) {
		// Attach user to event locals for use in load functions & API routes
		event.locals.user = { id: user.id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin };
	}

	// API routes: let each endpoint decide how to handle missing auth
	// (they check locals.user themselves and return 401 JSON)
	if (path.startsWith('/api')) {
		return resolve(event);
	}

	// Page routes: redirect unauthenticated users to login
	if (!user) {
		const next = encodeURIComponent(path + event.url.search);
		throw redirect(303, `/login?next=${next}`);
	}

	return resolve(event);
};
