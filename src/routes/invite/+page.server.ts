import { fail, redirect } from '@sveltejs/kit';
import {
	COOKIE_NAME,
	createSession,
	createUser,
	getUserByUsername,
	upsertUserCredential,
	validateInviteCode,
	consumeInviteCode,
	validateSession
} from '$lib/server/auth';
import { getEnabledConfigs, getServiceConfig } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { getDb, schema } from '$lib/db';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, cookies }) => {
	const code = url.searchParams.get('code') ?? '';

	// If already logged in, go to home
	const token = cookies.get(COOKIE_NAME);
	const user = validateSession(token);
	if (user) throw redirect(303, '/');

	if (!code) {
		return { valid: false, error: 'No invite code provided', authServices: [] };
	}

	const invite = validateInviteCode(code);
	if (!invite) {
		return { valid: false, error: 'This invite link is invalid or has expired', authServices: [] };
	}

	const authServices = getEnabledConfigs()
		.filter((c) => {
			const a = registry.get(c.type);
			return (c.type === 'jellyfin' || c.type === 'plex') && a?.authenticateUser;
		})
		.map((c) => ({ id: c.id, name: c.name, type: c.type }));

	return { valid: true, code, authServices };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the Nexus userId that has this externalUserId linked to this service */
function findUserByExternalId(serviceId: string, externalUserId: string): string | null {
	const db = getDb();
	const row = db
		.select({ userId: schema.userServiceCredentials.userId })
		.from(schema.userServiceCredentials)
		.where(
			and(
				eq(schema.userServiceCredentials.serviceId, serviceId),
				eq(schema.userServiceCredentials.externalUserId, externalUserId)
			)
		)
		.get();
	return row?.userId ?? null;
}

/** Generate a unique username by appending a suffix */
function generateUniqueUsername(base: string, suffix: string): string {
	const candidate = `${base}_${suffix}`;
	if (!getUserByUsername(candidate)) return candidate;
	for (let i = 2; i < 100; i++) {
		const attempt = `${base}_${suffix}${i}`;
		if (!getUserByUsername(attempt)) return attempt;
	}
	return `${base}_${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const code = (data.get('code') as string)?.trim();
		const authType = data.get('authType') as string | null;

		if (!code) {
			return fail(400, { error: 'Missing invite code' });
		}

		const invite = validateInviteCode(code);
		if (!invite) {
			return fail(400, { error: 'This invite link is invalid or has expired' });
		}

		// ── Service authentication (Jellyfin / Plex) ────────────────────────
		if (authType === 'service') {
			const serviceId = data.get('serviceId') as string;
			const username = (data.get('username') as string)?.trim();
			const password = data.get('password') as string;

			if (!serviceId || !username || !password) {
				return fail(400, { error: 'Service, username, and password are required', authType: 'service', serviceId });
			}

			// Look up service and adapter
			const config = getServiceConfig(serviceId);
			if (!config) {
				return fail(400, { error: 'Service not found', authType: 'service', serviceId });
			}
			const adapter = registry.get(config.type);
			if (!adapter?.authenticateUser) {
				return fail(400, { error: 'This service does not support authentication', authType: 'service', serviceId });
			}

			// Authenticate against the external service
			let authResult: { accessToken: string; externalUserId: string; externalUsername: string };
			try {
				authResult = await adapter.authenticateUser(config, username, password);
			} catch (e) {
				const msg = e instanceof Error ? e.message : 'Authentication failed';
				return fail(401, { error: msg, authType: 'service', serviceId, username });
			}

			// If a Nexus user already has this externalUserId linked, redirect to login
			const existingUserId = findUserByExternalId(serviceId, authResult.externalUserId);
			if (existingUserId) {
				throw redirect(303, '/login?message=account-exists');
			}

			// If a Nexus user with the same username exists, redirect to login
			if (getUserByUsername(authResult.externalUsername)) {
				throw redirect(303, '/login?message=account-exists');
			}

			// Create a new Nexus account — invited users are always active
			const typeSuffix = config.type === 'jellyfin' ? 'jf' : 'plex';
			let newUsername = authResult.externalUsername;
			if (getUserByUsername(newUsername)) {
				newUsername = generateUniqueUsername(newUsername, typeSuffix);
			}

			const randomPassword = crypto.randomUUID();
			const userId = createUser(newUsername, authResult.externalUsername, randomPassword, false, {
				authProvider: config.type,
				externalId: authResult.externalUserId,
				status: 'active'
			});

			// Link the credential
			upsertUserCredential(userId, serviceId, {
				accessToken: authResult.accessToken,
				externalUserId: authResult.externalUserId,
				externalUsername: authResult.externalUsername
			});

			// Consume the invite code
			consumeInviteCode(code);

			const token = createSession(userId);
			cookies.set(COOKIE_NAME, token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: false,
				maxAge: 30 * 86_400
			});

			throw redirect(303, '/');
		}

		// ── Local registration ──────────────────────────────────────────────
		const username = (data.get('username') as string)?.trim();
		const displayName = (data.get('displayName') as string)?.trim();
		const password = data.get('password') as string;
		const confirm = data.get('confirm') as string;

		if (!username || !displayName || !password) {
			return fail(400, { error: 'All fields are required' });
		}
		if (password.length < 6) {
			return fail(400, { error: 'Password must be at least 6 characters' });
		}
		if (password !== confirm) {
			return fail(400, { error: 'Passwords do not match' });
		}

		try {
			const userId = createUser(username, displayName, password, false);
			consumeInviteCode(code);

			const token = createSession(userId);
			cookies.set(COOKIE_NAME, token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: false,
				maxAge: 30 * 86_400
			});

			throw redirect(303, '/');
		} catch (e) {
			// Re-throw redirects
			if (e && typeof e === 'object' && 'status' in e) throw e;

			const msg = String(e);
			if (msg.includes('UNIQUE')) {
				return fail(400, { error: 'Username already taken' });
			}
			return fail(500, { error: 'Failed to create account' });
		}
	}
};
