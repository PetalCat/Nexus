import { describe, it, expect } from 'vitest';
import { requireUser, requireActiveUser, requireAdmin, type LocalsLike } from '../session-guard';

function makeEvent(user: Partial<NonNullable<App.Locals['user']>> | null): LocalsLike {
	return {
		locals: {
			user: user
				? ({
						id: user.id ?? 'u1',
						username: user.username ?? 'alice',
						displayName: user.displayName ?? 'Alice',
						avatar: user.avatar ?? null,
						isAdmin: user.isAdmin ?? false,
						status: user.status ?? 'active',
						forcePasswordReset: user.forcePasswordReset ?? false
					} as NonNullable<App.Locals['user']>)
				: undefined
		}
	};
}

function catchError(fn: () => unknown): { status: number; body: App.Error } {
	try {
		fn();
	} catch (err) {
		// SvelteKit's `error()` throws a HttpError-like object with a `status`.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const e = err as any;
		return { status: e.status, body: e.body };
	}
	throw new Error('expected throw');
}

describe('session-guard', () => {
	it('requireUser throws 401 with no-session reason when anon', () => {
		const { status, body } = catchError(() => requireUser(makeEvent(null)));
		expect(status).toBe(401);
		expect(body.nexusReason).toBe('no-session');
	});

	it('requireUser returns the user for a valid session', () => {
		const u = requireUser(makeEvent({ id: 'u7' }));
		expect(u.id).toBe('u7');
	});

	it('requireActiveUser rejects pending accounts with 403', () => {
		const { status, body } = catchError(() =>
			requireActiveUser(makeEvent({ status: 'pending' }))
		);
		expect(status).toBe(403);
		expect(body.nexusReason).toBe('pending-approval');
	});

	it('requireActiveUser rejects forcePasswordReset with 403', () => {
		const { status, body } = catchError(() =>
			requireActiveUser(makeEvent({ forcePasswordReset: true }))
		);
		expect(status).toBe(403);
		expect(body.nexusReason).toBe('password-reset-required');
	});

	it('requireActiveUser accepts a normal active user', () => {
		const u = requireActiveUser(makeEvent({ status: 'active', forcePasswordReset: false }));
		expect(u.username).toBe('alice');
	});

	it('requireAdmin rejects non-admin', () => {
		const { status, body } = catchError(() => requireAdmin(makeEvent({ isAdmin: false })));
		expect(status).toBe(403);
		expect(body.nexusReason).toBe('not-admin');
	});

	it('requireAdmin accepts admin', () => {
		const u = requireAdmin(makeEvent({ isAdmin: true }));
		expect(u.isAdmin).toBe(true);
	});
});
