import { fail, redirect } from '@sveltejs/kit';
import {
	COOKIE_NAME,
	createSession,
	createUser,
	getSetting,
	getUserByUsername,
	upsertUserCredential,
	validateSession
} from '$lib/server/auth';
import { getEnabledConfigs, getServiceConfig } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { getDb, schema } from '$lib/db';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	// Registration must be enabled
	if (getSetting('registration_enabled') !== 'true') {
		throw redirect(303, '/login');
	}

	// Already logged in
	const token = cookies.get(COOKIE_NAME);
	const user = validateSession(token);
	if (user) throw redirect(303, '/');

	const authServices = getEnabledConfigs()
		.filter((c) => {
			const a = registry.get(c.type);
			return (c.type === 'jellyfin' || c.type === 'plex') && a?.authenticateUser;
		})
		.map((c) => ({ id: c.id, name: c.name, type: c.type }));

	return { authServices };
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
		if (getSetting('registration_enabled') !== 'true') {
			return fail(403, { error: 'Registration is disabled' });
		}

		const data = await request.formData();
		const authType = data.get('authType') as string | null;

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

			// Create a new Nexus account
			const requiresApproval = getSetting('registration_requires_approval') === 'true';
			const status = requiresApproval ? 'pending' : 'active';
			const typeSuffix = config.type === 'jellyfin' ? 'jf' : 'plex';
			let newUsername = authResult.externalUsername;
			if (getUserByUsername(newUsername)) {
				newUsername = generateUniqueUsername(newUsername, typeSuffix);
			}

			const randomPassword = crypto.randomUUID();
			const userId = createUser(newUsername, authResult.externalUsername, randomPassword, false, {
				authProvider: config.type,
				externalId: authResult.externalUserId,
				status
			});

			// Link the credential
			upsertUserCredential(userId, serviceId, {
				accessToken: authResult.accessToken,
				externalUserId: authResult.externalUserId,
				externalUsername: authResult.externalUsername
			});

			const token = createSession(userId);
			cookies.set(COOKIE_NAME, token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 30
			});

			if (requiresApproval) {
				throw redirect(303, '/pending-approval');
			}
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

		const requiresApproval = getSetting('registration_requires_approval') === 'true';
		const status = requiresApproval ? 'pending' : 'active';

		try {
			const userId = createUser(username, displayName, password, false, { status });
			const token = createSession(userId);
			cookies.set(COOKIE_NAME, token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 30
			});

			if (requiresApproval) {
				throw redirect(303, '/pending-approval');
			}

			throw redirect(303, '/');
		} catch (e) {
			if (e && typeof e === 'object' && 'status' in e) throw e;
			const msg = String(e);
			if (msg.includes('UNIQUE')) {
				return fail(400, { error: 'Username already taken' });
			}
			return fail(500, { error: 'Failed to create account' });
		}
	}
};
