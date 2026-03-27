import { redirect, type Handle } from '@sveltejs/kit';
import { COOKIE_NAME, getUserCount, validateSession } from '$lib/server/auth';
import { startSessionPoller } from '$lib/server/session-poller';
import { startStatsScheduler } from '$lib/server/stats-scheduler';
import { startVideoNotificationPoller } from '$lib/server/video-notifications';
import { startRecScheduler } from '$lib/server/rec-scheduler';
import { initSocialWsHandlers } from '$lib/server/social-ws';
import { startHealthWatchdog, onServiceRecovery } from '$lib/server/health-watchdog';
import { broadcastToAll } from '$lib/server/ws';
import { startStreamProxy } from '$lib/server/stream-proxy';
import { getEnabledConfigs } from '$lib/server/services';
import { registerShutdownHandler } from '$lib/server/shutdown';

// Start background analytics
startSessionPoller();
startStatsScheduler();
startVideoNotificationPoller();
startRecScheduler();

// Start video stream proxy sub-server
const invConfig = getEnabledConfigs().find((c) => c.type === 'invidious');
if (invConfig) startStreamProxy(invConfig.url);

// Start health watchdog — detects service recovery and invalidates stale caches
startHealthWatchdog();

// When services recover, notify all connected clients so they can refresh
onServiceRecovery((recoveredIds) => {
	broadcastToAll({
		type: 'services:recovered',
		data: { serviceIds: recoveredIds }
	});
});

// Register social WS event handlers
initSocialWsHandlers();

// Register graceful shutdown handler for SIGTERM/SIGINT
registerShutdownHandler();

/** Paths that never require auth (login/setup flows) */
const NO_AUTH_PATHS = ['/login', '/setup', '/invite', '/register', '/pending-approval', '/reset-password', '/api/ingest/webhook'];

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
		event.locals.user = { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar ?? null, isAdmin: user.isAdmin };

		// API routes: let endpoints handle their own auth
		if (path.startsWith('/api')) {
			return resolve(event);
		}

		// Force password reset — lock user to /reset-password
		if (user.forcePasswordReset) {
			if (!path.startsWith('/reset-password') && !path.startsWith('/api/auth/logout')) {
				throw redirect(303, '/reset-password');
			}
		}

		// Pending approval — lock user to /pending-approval
		if (user.status === 'pending') {
			if (!path.startsWith('/pending-approval') && !path.startsWith('/api/auth/logout')) {
				throw redirect(303, '/pending-approval');
			}
		}
	}

	// API routes: let each endpoint decide how to handle missing auth
	if (path.startsWith('/api')) {
		return resolve(event);
	}

	// Page routes: redirect unauthenticated users to login
	if (!user) {
		const next = encodeURIComponent(path + event.url.search);
		throw redirect(303, `/login?next=${next}`);
	}

	const response = await resolve(event);

	// Security headers
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

	return response;
};
