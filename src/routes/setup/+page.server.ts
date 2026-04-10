import { fail, redirect } from '@sveltejs/kit';
import { COOKIE_NAME, createSession, createUser, getUserCount } from '$lib/server/auth';
import { upsertService } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	// Allow the page if: no users yet, OR user has an active session (mid-wizard).
	const hasSession = !!cookies.get(COOKIE_NAME);
	if (getUserCount() > 0 && !hasSession) {
		throw redirect(303, '/login');
	}

	const adapters = registry.onboardable().map((a) => ({
		id: a.id,
		displayName: a.displayName,
		color: a.color ?? '#888',
		abbreviation: a.abbreviation ?? a.id.slice(0, 2).toUpperCase(),
		onboarding: a.onboarding!,
	}));

	return { adapters };
};

export const actions: Actions = {
	createAccount: async ({ request, cookies }) => {
		const data = await request.formData();
		const username = (data.get('username') as string)?.trim();
		const displayName = (data.get('displayName') as string)?.trim();
		const password = data.get('password') as string;
		const confirm = data.get('confirm') as string;

		if (!username || !displayName || !password) {
			return fail(400, { error: 'All fields are required', step: 'account' });
		}
		if (password.length < 6) {
			return fail(400, { error: 'Password must be at least 6 characters', step: 'account' });
		}
		if (password !== confirm) {
			return fail(400, { error: 'Passwords do not match', step: 'account' });
		}

		const userId = createUser(username, displayName, password, true);
		const token = createSession(userId);

		cookies.set(COOKIE_NAME, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});

		return { success: true, step: 'account' };
	},

	connectService: async ({ request }) => {
		const data = await request.formData();
		const serviceType = data.get('type') as string;
		const url = (data.get('url') as string)?.trim().replace(/\/+$/, '');
		const apiKey = (data.get('apiKey') as string)?.trim() || undefined;
		const username = (data.get('username') as string)?.trim() || undefined;
		const password = (data.get('password') as string) || undefined;

		if (!serviceType || !url) {
			return fail(400, { error: 'Service type and URL are required', step: 'service' });
		}

		const adapter = registry.get(serviceType);
		if (!adapter) {
			return fail(400, { error: 'Unknown service type', step: 'service' });
		}

		const config = {
			id: serviceType,
			name: adapter.displayName,
			type: serviceType,
			url,
			apiKey: apiKey ?? undefined,
			username: username ?? undefined,
			password: password ?? undefined,
			enabled: true,
		};

		if (adapter.onboarding?.supportsAutoAuth && adapter.authenticateUser && username && password && !apiKey) {
			try {
				const cred = await adapter.authenticateUser(config, username, password);
				config.apiKey = cred.accessToken;
			} catch (e) {
				return fail(400, {
					error: `Connected but auto-authentication failed: ${e instanceof Error ? e.message : String(e)}. Try adding an API key instead.`,
					step: 'service',
					serviceType,
				});
			}
		}

		try {
			const health = await adapter.ping(config);
			if (!health.online) {
				return fail(400, {
					error: `Connection failed: ${health.error ?? 'Unknown error'}`,
					step: 'service',
					serviceType,
				});
			}
		} catch (e) {
			return fail(400, {
				error: `Could not reach ${adapter.displayName} at ${url}`,
				step: 'service',
				serviceType,
			});
		}

		upsertService(config);

		return { success: true, step: 'service', serviceType, serviceName: adapter.displayName };
	},
};
