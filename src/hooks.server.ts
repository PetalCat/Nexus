import { redirect, type Handle } from '@sveltejs/kit';
import { checkRateLimit, getClientIp } from '$lib/server/rate-limit';
import { COOKIE_NAME, getUserCount, validateSession } from '$lib/server/auth';
import { boot } from '$lib/server/boot';

// All server-startup concerns (crypto validation, pollers, schedulers, stream
// proxy, watchdog, lifecycle) are orchestrated in `$lib/server/boot`. Keep
// hooks.server.ts focused on per-request middleware.
boot();

/** Paths that never require auth (login/setup flows) */
const NO_AUTH_PATHS = ['/login', '/setup', '/invite', '/register', '/pending-approval', '/reset-password', '/api/ingest/webhook'];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	// 2026-04-17: `/collections` renamed to `/library/catalogs` to
	// disambiguate adapter-sourced catalogs from user/social collections.
	// Preserve bookmarks with a 301.
	if (path === '/collections' || path.startsWith('/collections/')) {
		const target = '/library/catalogs' + path.slice('/collections'.length);
		throw redirect(301, target + (event.url.search ?? ''));
	}

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

		// API routes: let endpoints handle their own auth, BUT enforce the
		// pending/forcePasswordReset gates globally before any endpoint runs.
		// (issue #7 — previously API routes only saw `!locals.user` checks and
		// silently accepted pending or password-locked accounts.)
		//
		// Allowlist: `/api/auth/*` endpoints must still be reachable so users
		// can log out and go through the reset-password flow. Everything else
		// under `/api/` gets the gate.
		if (path.startsWith('/api')) {
			const isAuthApi = path.startsWith('/api/auth');
			if (!isAuthApi && user.forcePasswordReset) {
				return new Response(
					JSON.stringify({ message: 'Password reset required', nexusReason: 'password-reset-required' }),
					{
						status: 403,
						headers: {
							'Content-Type': 'application/json',
							'X-Nexus-Reason': 'password-reset-required'
						}
					}
				);
			}
			if (!isAuthApi && user.status === 'pending') {
				return new Response(
					JSON.stringify({ message: 'Account pending approval', nexusReason: 'pending-approval' }),
					{
						status: 403,
						headers: {
							'Content-Type': 'application/json',
							'X-Nexus-Reason': 'pending-approval'
						}
					}
				);
			}
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

		// First-run welcome flow. 2026-04-17 (#24): admins also pass through
		// /welcome exactly once — global install state (/setup) and per-user
		// state (/welcome) are now orthogonal. The flag is set to an ISO
		// timestamp when the user finishes the wizard via actions.complete —
		// null means they've never seen it.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const welcomeCompletedAt = (user as any).welcomeCompletedAt as string | null | undefined;
		if (
			!welcomeCompletedAt &&
			!path.startsWith('/welcome') &&
			!path.startsWith('/setup') &&
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
