import { redirect, type Handle } from '@sveltejs/kit';
import { checkRateLimit, getClientIp } from '$lib/server/rate-limit';
import { COOKIE_NAME, getUserCount, validateSession } from '$lib/server/auth';
import { assertEncryptionKey } from '$lib/server/crypto';
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
import { installTunedDispatcher } from '$lib/server/http-pool';

// Hard-fail boot if NEXUS_ENCRYPTION_KEY is missing or malformed. We never
// silently store plaintext — parker's directive for the Apr-17 security
// hardening work (issue #5).
assertEncryptionKey();

// Tune undici before any outbound fetch fires — raises per-origin connection
// cap so the image-proxy hot path doesn't queue on the default of 5.
installTunedDispatcher();

// Start background analytics
startSessionPoller();
startStatsScheduler();
startVideoNotificationPoller();
startRecScheduler();

// Start video stream proxy sub-server — always start so Jellyfin HLS delivery
// works regardless of whether Invidious is configured. The binary's Invidious
// features are dormant when no Invidious service is set up; Jellyfin HLS
// session handoff works unconditionally.
const invConfig = getEnabledConfigs().find((c) => c.type === 'invidious');
startStreamProxy(invConfig?.url ?? 'http://localhost:3000');

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

	// Rate limiting — skip health endpoint and image proxy to avoid interfering with uptime checks / page loads
	if (!path.startsWith('/api/health') && !path.startsWith('/api/media/image')) {
		const clientIp = getClientIp(event);
		const isAuthEndpoint = ['/login', '/setup', '/register', '/api/auth'].some(
			(p) => path.startsWith(p)
		);
		const limit = isAuthEndpoint ? 10 : 300;
		const window = 60_000; // 1 minute

		if (!checkRateLimit(clientIp, limit, window)) {
			return new Response(JSON.stringify({ error: 'Too many requests' }), {
				status: 429,
				headers: { 'Content-Type': 'application/json', 'Retry-After': '60' }
			});
		}
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
		event.locals.user = {
			id: user.id,
			username: user.username,
			displayName: user.displayName,
			avatar: user.avatar ?? null,
			isAdmin: user.isAdmin,
			status: (user.status === 'pending' ? 'pending' : 'active'),
			forcePasswordReset: !!user.forcePasswordReset
		};

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

		// First-run welcome flow for non-admin users.
		// Admins go through /setup; regular users get /welcome. The flag is
		// set to an ISO timestamp when the user finishes the wizard via
		// actions.complete — null means they've never seen it.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const welcomeCompletedAt = (user as any).welcomeCompletedAt as string | null | undefined;
		if (
			!user.isAdmin &&
			!welcomeCompletedAt &&
			!path.startsWith('/welcome') &&
			!path.startsWith('/login') &&
			!path.startsWith('/logout') &&
			!path.startsWith('/api/auth/logout') &&
			!path.startsWith('/reset-password') &&
			!path.startsWith('/_app') &&
			path !== '/favicon.ico'
		) {
			throw redirect(303, '/welcome');
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
