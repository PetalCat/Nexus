import { redirect, type Handle } from '@sveltejs/kit';
import { checkRateLimit, getClientIp } from '$lib/server/rate-limit';
import { COOKIE_NAME, validateSession } from '$lib/server/auth';
import { boot } from '$lib/server/boot';
import { NO_AUTH_PATHS, resolveRedirect } from '$lib/server/redirects';

// All server-startup concerns (crypto validation, pollers, schedulers, stream
// proxy, watchdog, lifecycle) are orchestrated in `$lib/server/boot`. Keep
// hooks.server.ts focused on per-request middleware: rate limiting, session
// loading, redirect dispatch, API gates, and security headers.
boot();

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	// Allowlisted pre-auth paths bypass rate limiting + the API state gate,
	// but still go through session loading and the redirect resolver — the
	// resolver now owns the per-entry-point lifecycle gates (#32), so we
	// can't short-circuit around it any more.
	const isAllowlisted = NO_AUTH_PATHS.some((p) => path.startsWith(p));

	// Rate limiting.
	//
	// The tight auth bucket (10/min) is meant to throttle credential-stuffing
	// POSTs — login/register/password-reset attempts. Applying it to every
	// hit on these paths also throttles GET page loads of /login and the
	// /welcome wizard, which legitimately fire several times per minute
	// during normal use (wizard form validations, page refreshes, image
	// preloads on /login). That made tight setups behind a reverse proxy
	// without X-Forwarded-For respect — where every client shares the
	// 127.0.0.1 bucket — 429 on page navigation alone.
	//
	// Narrow the tight bucket to state-changing verbs on auth paths; GETs
	// fall into the general 300/min bucket.
	const isAuthPath = ['/login', '/welcome', '/register', '/api/auth'].some((p) =>
		path.startsWith(p)
	);
	const isWriteMethod = event.request.method !== 'GET' && event.request.method !== 'HEAD';
	const isAuthWrite = isAuthPath && isWriteMethod;
	const shouldRateLimit =
		!process.env.NEXUS_DISABLE_RATE_LIMIT &&
		(isAuthWrite ||
			(!isAllowlisted &&
				!path.startsWith('/api/health') &&
				!path.startsWith('/api/media/image')));

	if (shouldRateLimit) {
		const clientIp = getClientIp(event);
		const limit = isAuthWrite ? 10 : 300;
		const window = 60_000; // 1 minute

		if (!checkRateLimit(clientIp, limit, window)) {
			return new Response(JSON.stringify({ error: 'Too many requests' }), {
				status: 429,
				headers: { 'Content-Type': 'application/json', 'Retry-After': '60' }
			});
		}
	}

	// Populate event.locals.user from the session cookie — this is the session
	// hook's job and stays here. Redirect rules and API gates both read from it.
	const token = event.cookies.get(COOKIE_NAME);
	const user = validateSession(token);
	if (user) {
		event.locals.user = {
			id: user.id,
			username: user.username,
			displayName: user.displayName,
			avatar: user.avatar ?? null,
			isAdmin: user.isAdmin,
			status: user.status === 'pending' ? 'pending' : 'active',
			forcePasswordReset: !!user.forcePasswordReset
		};
	}

	// Delegate onboarding/auth/legacy-URL redirects to the canonical resolver.
	const target = resolveRedirect(user, path, event.url.search ?? '');
	if (target) {
		throw redirect(target.status, target.location);
	}

	// API state gate: for logged-in users, enforce pending/forcePasswordReset
	// before any /api/* endpoint runs. Non-auth `/api/*` routes have already
	// been cleared by the resolver (which returns null for /api/*). We still
	// need to gate the pending/locked states here because the resolver does
	// not redirect /api/* — it leaves the gate to hooks, where we respond with
	// a structured 403 instead of redirecting an API call. (#7)
	//
	// Skipped for allowlisted paths (/api/ingest/webhook) — those are
	// intentionally callable without a session.
	if (user && !isAllowlisted && path.startsWith('/api')) {
		const isAuthApi = path.startsWith('/api/auth');
		if (!isAuthApi && user.forcePasswordReset) {
			return new Response(
				JSON.stringify({
					message: 'Password reset required',
					nexusReason: 'password-reset-required'
				}),
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
				JSON.stringify({
					message: 'Account pending approval',
					nexusReason: 'pending-approval'
				}),
				{
					status: 403,
					headers: {
						'Content-Type': 'application/json',
						'X-Nexus-Reason': 'pending-approval'
					}
				}
			);
		}
	}

	const response = await resolve(event);

	// Security headers
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

	return response;
};
