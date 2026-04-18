import { fail, redirect } from '@sveltejs/kit';
import {
	COOKIE_NAME,
	createSession,
	createUser,
	getSetting,
	getUserByUsername,
	getUserCount,
	upsertUserCredential,
	verifyPassword
} from '$lib/server/auth';
import { getEnabledConfigs, getServiceConfig } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { getDb, schema } from '$lib/db';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (getUserCount() === 0) throw redirect(303, '/welcome');
	if (locals.user) throw redirect(303, url.searchParams.get('next') || '/');
	const registrationEnabled = getSetting('registration_enabled') === 'true';

	const authServices = getEnabledConfigs()
		.filter((c) => {
			const a = registry.get(c.type);
			return (c.type === 'jellyfin' || c.type === 'plex') && a?.authenticateUser;
		})
		.map((c) => ({ id: c.id, name: c.name, type: c.type }));

	return { registrationEnabled, authServices };
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
	// If that's taken too, add a number
	for (let i = 2; i < 100; i++) {
		const attempt = `${base}_${suffix}${i}`;
		if (!getUserByUsername(attempt)) return attempt;
	}
	return `${base}_${Date.now()}`;
}

/** Create session, set cookie, and determine redirect */
function finishLogin(
	userId: string,
	user: { status?: string | null; forcePasswordReset?: boolean | null },
	cookies: Parameters<Actions['default']>[0]['cookies'],
	url: URL
) {
	const token = createSession(userId);
	cookies.set(COOKIE_NAME, token, {
		path: '/',
		httpOnly: true,
		secure: false,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 30
	});

	if (user.status === 'pending') {
		throw redirect(303, '/pending-approval');
	}
	if (user.forcePasswordReset) {
		throw redirect(303, '/reset-password');
	}
	const next = url.searchParams.get('next') || '/';
	throw redirect(303, next);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const data = await request.formData();
		const authType = data.get('authType') as string | null;

		// ── Service authentication (Jellyfin / Plex) ────────────────────────
		if (authType === 'service') {
			const serviceId = data.get('serviceId') as string;
			const username = (data.get('username') as string)?.trim();
			const password = data.get('password') as string;
			const nexusPassword = data.get('nexusPassword') as string | null;

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

			// 1. Check if a Nexus user already has this externalUserId linked
			const existingUserId = findUserByExternalId(serviceId, authResult.externalUserId);
			if (existingUserId) {
				// Update the credential (token may have changed)
				upsertUserCredential(existingUserId, serviceId, {
					accessToken: authResult.accessToken,
					externalUserId: authResult.externalUserId,
					externalUsername: authResult.externalUsername
				});
				const db = getDb();
				const user = db
					.select()
					.from(schema.users)
					.where(eq(schema.users.id, existingUserId))
					.get();
				if (!user) {
					return fail(500, { error: 'Linked user account not found', authType: 'service', serviceId });
				}
				return finishLogin(existingUserId, user, cookies, url);
			}

			// 2. Check if a Nexus user with the same username exists
			const usernameMatch = getUserByUsername(authResult.externalUsername);
			if (usernameMatch) {
				// Collision: need to verify they own the Nexus account
				if (!nexusPassword) {
					return fail(409, {
						error: `A Nexus account "${authResult.externalUsername}" already exists. Enter your Nexus password to link it, or choose a different approach.`,
						needsNexusPassword: true,
						authType: 'service',
						serviceId,
						username,
						collisionUsername: authResult.externalUsername
					});
				}

				// Verify the Nexus password
				if (!verifyPassword(nexusPassword, usernameMatch.passwordHash)) {
					return fail(401, {
						error: 'Incorrect Nexus password. Try again or contact an admin.',
						needsNexusPassword: true,
						authType: 'service',
						serviceId,
						username,
						collisionUsername: authResult.externalUsername
					});
				}

				// Password verified — link the credential
				upsertUserCredential(usernameMatch.id, serviceId, {
					accessToken: authResult.accessToken,
					externalUserId: authResult.externalUserId,
					externalUsername: authResult.externalUsername
				});
				return finishLogin(usernameMatch.id, usernameMatch, cookies, url);
			}

			// 3. No collision — create a new Nexus account
			const requiresApproval = getSetting('registration_requires_approval') === 'true';
			const status = requiresApproval ? 'pending' : 'active';
			const typeSuffix = config.type === 'jellyfin' ? 'jf' : 'plex';
			// Use the external username, but ensure uniqueness
			let newUsername = authResult.externalUsername;
			if (getUserByUsername(newUsername)) {
				newUsername = generateUniqueUsername(newUsername, typeSuffix);
			}

			// Generate a random password for the Nexus account (user authenticates via service)
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

			const db2 = getDb();
			const newUser = db2
				.select()
				.from(schema.users)
				.where(eq(schema.users.id, userId))
				.get();
			return finishLogin(userId, newUser ?? { status }, cookies, url);
		}

		// ── Local authentication ────────────────────────────────────────────
		const username = (data.get('username') as string)?.trim();
		const password = data.get('password') as string;

		if (!username || !password) {
			return fail(400, { error: 'Username and password are required' });
		}

		const user = getUserByUsername(username);
		if (!user || !verifyPassword(password, user.passwordHash)) {
			return fail(401, { error: 'Invalid username or password' });
		}

		return finishLogin(user.id, user, cookies, url);
	}
};
