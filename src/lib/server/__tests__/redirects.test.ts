/**
 * Canonical state-machine tests for resolveRedirect.
 *
 * The resolver governs four onboarding entry points (/welcome, /register,
 * /invite, /pending-approval) plus the general logged-in / logged-out flows.
 * These tests pin the (user × status × path × settings) tuples so that
 * future changes to the state machine force an explicit test update, and
 * so drift between the resolver and the routes can't regress silently.
 * (#32, #24)
 *
 * The `/setup` route was retired in #24; fresh-install admin creation now
 * happens at `/welcome` too. Tests that previously pinned /setup behavior
 * have been adapted to /welcome.
 */
import { describe, it, expect } from 'vitest';
import { resolveRedirect, type RedirectUser } from '../redirects';

type FakeSettings = Record<string, string>;

function mkOpts(opts: {
	userCount?: number;
	settings?: FakeSettings;
}) {
	return {
		getUserCount: () => opts.userCount ?? 1,
		getSetting: (key: string) => opts.settings?.[key] ?? null
	};
}

const activeUser: RedirectUser = {
	status: 'active',
	forcePasswordReset: false,
	welcomeCompletedAt: '2026-04-01T00:00:00Z'
};

const pendingUser: RedirectUser = {
	status: 'pending',
	forcePasswordReset: false,
	welcomeCompletedAt: '2026-04-01T00:00:00Z'
};

const lockedUser: RedirectUser = {
	status: 'active',
	forcePasswordReset: true,
	welcomeCompletedAt: '2026-04-01T00:00:00Z'
};

const freshUser: RedirectUser = {
	status: 'active',
	forcePasswordReset: false,
	welcomeCompletedAt: null
};

describe('resolveRedirect — legacy URL rewrites', () => {
	it('rewrites /collections → /library/catalogs (301)', () => {
		const t = resolveRedirect(null, '/collections', '', mkOpts({}));
		expect(t).toEqual({ location: '/library/catalogs', status: 301 });
	});

	it('preserves sub-paths and query under /collections', () => {
		const t = resolveRedirect(null, '/collections/foo', '?q=1', mkOpts({}));
		expect(t).toEqual({ location: '/library/catalogs/foo?q=1', status: 301 });
	});
});

describe('resolveRedirect — first-run (no users yet)', () => {
	it('redirects anything-but-/welcome to /welcome', () => {
		const opts = mkOpts({ userCount: 0 });
		expect(resolveRedirect(null, '/login', '', opts)).toEqual({
			location: '/welcome',
			status: 303
		});
		expect(resolveRedirect(null, '/', '', opts)).toEqual({
			location: '/welcome',
			status: 303
		});
		expect(resolveRedirect(null, '/register', '', opts)).toEqual({
			location: '/welcome',
			status: 303
		});
	});

	it('lets /welcome through during first-run so the admin-create form renders', () => {
		const opts = mkOpts({ userCount: 0 });
		expect(resolveRedirect(null, '/welcome', '', opts)).toBeNull();
	});

	it('first-run + /welcome sub-path passes through too', () => {
		const opts = mkOpts({ userCount: 0 });
		expect(resolveRedirect(null, '/welcome/foo', '', opts)).toBeNull();
	});

	it('first-run + user-less session on /welcome → null (admin-create form renders)', () => {
		// Even with user === null (no session), userCount===0 means the /welcome
		// route should render its admin-create branch. Rule 2 wins over rule 3d.
		const opts = mkOpts({ userCount: 0 });
		expect(resolveRedirect(null, '/welcome', '', opts)).toBeNull();
	});

	it('first-run does NOT redirect API paths — they bypass rule 2', () => {
		// API routes are data endpoints, not browser surfaces — bouncing a
		// 303 from /api/health (or any other /api/*) would crash reverse-proxy
		// health checks and polling clients that don't follow redirects.
		// Fixed during the 10.10.10.15 deploy smoke-test.
		const opts = mkOpts({ userCount: 0 });
		expect(resolveRedirect(null, '/api/library', '', opts)).toBeNull();
		expect(resolveRedirect(null, '/api/health', '', opts)).toBeNull();
	});
});

describe('resolveRedirect — /register lifecycle', () => {
	it('registration disabled → /login', () => {
		const t = resolveRedirect(null, '/register', '', mkOpts({ userCount: 1 }));
		expect(t).toEqual({ location: '/login', status: 303 });
	});

	it('already-logged-in → /', () => {
		const opts = mkOpts({ userCount: 1, settings: { registration_enabled: 'true' } });
		const t = resolveRedirect(activeUser, '/register', '', opts);
		expect(t).toEqual({ location: '/', status: 303 });
	});

	it('anonymous + registration enabled → null', () => {
		const opts = mkOpts({ userCount: 1, settings: { registration_enabled: 'true' } });
		expect(resolveRedirect(null, '/register', '', opts)).toBeNull();
	});
});

describe('resolveRedirect — /invite lifecycle', () => {
	it('already-logged-in → /', () => {
		const t = resolveRedirect(activeUser, '/invite', '?code=abc', mkOpts({ userCount: 1 }));
		expect(t).toEqual({ location: '/', status: 303 });
	});

	it('anonymous → null (page validates the code)', () => {
		expect(resolveRedirect(null, '/invite', '?code=abc', mkOpts({ userCount: 1 }))).toBeNull();
	});
});

describe('resolveRedirect — /pending-approval lifecycle', () => {
	it('no user → /login', () => {
		const t = resolveRedirect(null, '/pending-approval', '', mkOpts({ userCount: 1 }));
		expect(t).toEqual({ location: '/login', status: 303 });
	});

	it('active user → / (they no longer belong here)', () => {
		const t = resolveRedirect(activeUser, '/pending-approval', '', mkOpts({ userCount: 1 }));
		expect(t).toEqual({ location: '/', status: 303 });
	});

	it('pending user → null (let through)', () => {
		const t = resolveRedirect(pendingUser, '/pending-approval', '', mkOpts({ userCount: 1 }));
		expect(t).toBeNull();
	});
});

describe('resolveRedirect — /welcome lifecycle (post-first-run)', () => {
	it('no user (users exist) → /login', () => {
		const t = resolveRedirect(null, '/welcome', '', mkOpts({ userCount: 1 }));
		expect(t).toEqual({ location: '/login', status: 303 });
	});

	it('logged-in + fresh user → null (the route renders)', () => {
		const t = resolveRedirect(freshUser, '/welcome', '', mkOpts({ userCount: 1 }));
		expect(t).toBeNull();
	});

	it('logged-in + already-completed user → null (route decides via DB read + ?force=1)', () => {
		// Resolver doesn't gate /welcome for already-completed users; the route's
		// fresh DB read does. This test pins that contract.
		const t = resolveRedirect(activeUser, '/welcome', '', mkOpts({ userCount: 1 }));
		expect(t).toBeNull();
	});
});

describe('resolveRedirect — logged-in lifecycle locks', () => {
	it('forcePasswordReset → /reset-password (from non-API, non-lock paths)', () => {
		const t = resolveRedirect(lockedUser, '/library', '', mkOpts({ userCount: 1 }));
		expect(t).toEqual({ location: '/reset-password', status: 303 });
	});

	it('pending user on a gated page → /pending-approval', () => {
		const t = resolveRedirect(pendingUser, '/library', '', mkOpts({ userCount: 1 }));
		expect(t).toEqual({ location: '/pending-approval', status: 303 });
	});

	it('fresh user (no welcomeCompletedAt) → /welcome', () => {
		const t = resolveRedirect(freshUser, '/library', '', mkOpts({ userCount: 1 }));
		expect(t).toEqual({ location: '/welcome', status: 303 });
	});

	it('API routes skip lock redirects (hooks gate handles them as 403s)', () => {
		expect(resolveRedirect(lockedUser, '/api/library', '', mkOpts({ userCount: 1 }))).toBeNull();
		expect(resolveRedirect(pendingUser, '/api/library', '', mkOpts({ userCount: 1 }))).toBeNull();
	});
});

describe('resolveRedirect — anonymous non-API → /login?next=', () => {
	it('captures path + query into ?next=', () => {
		const t = resolveRedirect(null, '/library', '?tab=watchlist', mkOpts({ userCount: 1 }));
		expect(t?.location).toBe('/login?next=' + encodeURIComponent('/library?tab=watchlist'));
		expect(t?.status).toBe(303);
	});

	it('anonymous /api/* stays null — the endpoint returns its own 401', () => {
		expect(resolveRedirect(null, '/api/library', '', mkOpts({ userCount: 1 }))).toBeNull();
	});
});

describe('resolveRedirect — allowlist + active user passthrough', () => {
	it('/login + active user → null (resolver lets /login render; route decides)', () => {
		expect(resolveRedirect(activeUser, '/login', '', mkOpts({ userCount: 1 }))).toBeNull();
	});

	it('/reset-password + locked user → null (the user needs to reach the form)', () => {
		expect(
			resolveRedirect(lockedUser, '/reset-password', '', mkOpts({ userCount: 1 }))
		).toBeNull();
	});

	it('/api/ingest/webhook stays allowlisted even for anonymous', () => {
		expect(
			resolveRedirect(null, '/api/ingest/webhook', '', mkOpts({ userCount: 1 }))
		).toBeNull();
	});

	it('active user on / → null', () => {
		expect(resolveRedirect(activeUser, '/', '', mkOpts({ userCount: 1 }))).toBeNull();
	});
});
