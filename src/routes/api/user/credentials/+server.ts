import { json } from '@sveltejs/kit';
import { getUserCredentials, getUserCredentialForService, upsertUserCredential, deleteUserCredential } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getServiceConfig, getServiceConfigs } from '$lib/server/services';
import { importJellyfinUser } from '$lib/adapters/overseerr';
import { invalidatePrefix } from '$lib/server/cache';
import { getDb, schema } from '$lib/db';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/** Invalidate user-specific caches when credentials change. */
function invalidateUserCaches(userId: string) {
	invalidatePrefix(`cw:${userId}`);
	invalidatePrefix(`activity:${userId}`);
	invalidatePrefix(`ss-recs-`);
	invalidatePrefix(`requests:user:${userId}`);
	invalidatePrefix(`api-requests:user:${userId}`);
}

// GET /api/user/credentials — List the current user's linked service accounts
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const credentials = getUserCredentials(locals.user.id);
	// Don't send raw tokens back to the client — just service info
	return json(
		credentials.map((c) => ({
			serviceId: c.serviceId,
			externalUserId: c.externalUserId,
			externalUsername: c.externalUsername,
			linkedAt: c.linkedAt,
			managed: c.managed,
			linkedVia: c.linkedVia
		}))
	);
};

// POST /api/user/credentials — Link a service account (authenticate against service)
// Body: { serviceId, username, password } for manual link
// Body: { serviceId, autoLink: true } for Jellyfin-based auto-link
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { serviceId, autoLink } = body;

	if (!serviceId) return json({ error: 'Missing serviceId' }, { status: 400 });

	const config = getServiceConfig(serviceId);
	if (!config) return json({ error: 'Service not found' }, { status: 404 });

	const adapter = registry.get(config.type);
	// Derived adapters (streamystats) authenticate via a parent service's token
	// rather than their own login flow, so they don't set userLinkable but still
	// accept user credentials through the autoLink path below.
	const isDerivedUserService = config.type === 'streamystats';
	if (!adapter?.userLinkable && !isDerivedUserService) {
		return json({ error: 'This service does not support user-level accounts' }, { status: 400 });
	}

	// ── Pick flow: user selects from unclaimed service accounts ──────────
	if (body.pickExternalId) {
		const adapter = registry.get(config.type);
		if (!adapter?.resetPassword || !adapter?.authenticateUser) {
			return json({ error: 'This service does not support account picking' }, { status: 400 });
		}

		try {
			// Verify the account exists and is unclaimed
			if (!adapter.getUsers) {
				return json({ error: 'Service does not support user listing' }, { status: 400 });
			}
			const users = await adapter.getUsers(config);
			const target = users.find((u) => u.externalId === body.pickExternalId);
			if (!target) {
				return json({ error: 'Account not found on service' }, { status: 404 });
			}

			// Check if already claimed by another user
			const db = getDb();
			const existing = db
				.select()
				.from(schema.userServiceCredentials)
				.where(
					and(
						eq(schema.userServiceCredentials.serviceId, serviceId),
						eq(schema.userServiceCredentials.externalUserId, body.pickExternalId)
					)
				)
				.get();
			if (existing) {
				return json({ error: 'This account is already claimed by another user' }, { status: 409 });
			}

			// Reset password, authenticate, store credential
			const { randomBytes } = await import('crypto');
			const tempPw = randomBytes(24).toString('base64url');
			await adapter.resetPassword(config, target.externalId, tempPw);
			const result = await adapter.authenticateUser(config, target.username, tempPw);
			upsertUserCredential(locals.user.id, serviceId, {
				accessToken: result.accessToken,
				externalUserId: result.externalUserId,
				externalUsername: result.externalUsername
			});
			invalidateUserCaches(locals.user.id);

			// Cascade auto-link for dependent services (e.g., Overseerr via Jellyfin)
			if (config.type === 'jellyfin') {
				const { autoLinkJellyfinServices } = await import('$lib/server/services');
				await autoLinkJellyfinServices(locals.user.id).catch(() => {});
			}

			return json({
				serviceId,
				externalUserId: result.externalUserId,
				externalUsername: result.externalUsername
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return json({ error: msg }, { status: 500 });
		}
	}

	// ── Auto-link path: match by Jellyfin user ID ──────────────────────────
	// Used when Overseerr is in Jellyfin auth mode. We look up the Overseerr user
	// whose jellyfinUserId matches the user's linked Jellyfin externalUserId.
	if (autoLink) {
		// Find a Jellyfin service this user has credentials for
		const allServices = getServiceConfigs();
		let jellyfinCred: { externalUserId: string; externalUsername: string; accessToken: string } | null = null;

		for (const svc of allServices) {
			if (svc.type === 'jellyfin') {
				const cred = getUserCredentialForService(locals.user.id, svc.id);
				if (cred?.externalUserId) {
					jellyfinCred = {
						externalUserId: cred.externalUserId,
						externalUsername: cred.externalUsername ?? '',
						accessToken: cred.accessToken ?? ''
					};
					break;
				}
			}
		}

		if (!jellyfinCred) {
			return json({ error: 'No linked Jellyfin account found. Link Jellyfin first.' }, { status: 400 });
		}

		// ── StreamyStats: copy Jellyfin token directly (no getUsers needed) ──
		if (config.type === 'streamystats') {
			try {
				const jfSvc = allServices.find((s) => s.type === 'jellyfin' && s.enabled);
				if (!jfSvc) {
					return json({ error: 'No Jellyfin service configured.' }, { status: 400 });
				}
				const { resolveStreamystatsServerUrl } = await import('$lib/server/services');
				const serverUrl = await resolveStreamystatsServerUrl(config, jfSvc);
				if (!serverUrl) {
					return json(
						{
							error:
								'StreamyStats has no servers registered. Open StreamyStats and connect it to your Jellyfin first.'
						},
						{ status: 400 }
					);
				}
				const testUrl = new URL(`${config.url.replace(/\/+$/, '')}/api/recommendations`);
				testUrl.searchParams.set('serverUrl', serverUrl);
				testUrl.searchParams.set('limit', '1');
				const res = await fetch(testUrl.toString(), {
					headers: { Authorization: `MediaBrowser Token="${jellyfinCred.accessToken}"` },
					signal: AbortSignal.timeout(8000)
				});
				if (!res.ok) {
					return json(
						{
							error: `StreamyStats rejected Jellyfin token (${res.status}) for server ${serverUrl}. Make sure your Jellyfin user exists in StreamyStats.`
						},
						{ status: 400 }
					);
				}
				upsertUserCredential(locals.user.id, serviceId, {
					accessToken: jellyfinCred.accessToken,
					externalUserId: jellyfinCred.externalUserId,
					externalUsername: jellyfinCred.externalUsername
				});
				invalidateUserCaches(locals.user.id);
				return json({ serviceId, externalUserId: jellyfinCred.externalUserId, externalUsername: jellyfinCred.externalUsername });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return json({ error: msg }, { status: 500 });
			}
		}

		// ── Standard auto-link: match by Jellyfin user ID in service user list ──
		if (!adapter.getUsers) {
			return json({ error: 'Auto-link not supported for this service' }, { status: 400 });
		}

		try {
			let users = await adapter.getUsers(config);
			let match = users.find((u) => u.jellyfinUserId === jellyfinCred!.externalUserId);

			// If no match and this is an Overseerr service, auto-import the Jellyfin user
			if (!match && config.type === 'overseerr') {
				const imported = await importJellyfinUser(config, jellyfinCred!.externalUserId);
				if (imported) {
					// Re-fetch users to find the newly imported account
					users = await adapter.getUsers(config);
					match = users.find((u) => u.jellyfinUserId === jellyfinCred!.externalUserId);
				}
			}

			if (!match) {
				return json({ error: 'Could not find or create an account for your Jellyfin user on this service.' }, { status: 404 });
			}
			upsertUserCredential(locals.user.id, serviceId, {
				accessToken: '', // admin API key used for requests
				externalUserId: match.externalId,
				externalUsername: match.username
			});
			invalidateUserCaches(locals.user.id);
			return json({ serviceId, externalUserId: match.externalId, externalUsername: match.username });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return json({ error: msg }, { status: 500 });
		}
	}

	// ── Manual link path: username + password ──────────────────────────────
	const { username, password, mode, storePassword } = body;
	if (!username || !password) {
		return json({ error: 'Missing username or password' }, { status: 400 });
	}

	if (!adapter.authenticateUser) {
		return json({ error: 'This service does not support user authentication yet' }, { status: 501 });
	}

	try {
		const result = await adapter.authenticateUser(
			config,
			username,
			password,
			mode === 'register' ? 'register' : 'signin'
		);
		upsertUserCredential(locals.user.id, serviceId, {
			accessToken: result.accessToken,
			externalUserId: result.externalUserId,
			externalUsername: result.externalUsername,
			// Only store the password if the user explicitly opted in AND the
			// adapter supports stored-password refresh.
			storedPassword:
				storePassword === true && adapter.capabilities?.userAuth?.supportsPasswordStorage
					? password
					: undefined,
			extraAuth: result.extraAuth ?? undefined
		});
		invalidateUserCaches(locals.user.id);
		return json({
			serviceId,
			externalUserId: result.externalUserId,
			externalUsername: result.externalUsername
		});
	} catch (e) {
		// Pass structured error kind + message back so the UI can map to copy.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const kind = (e as any)?.kind ?? 'unknown';
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[API] credential link error:', msg);
		return json({ error: msg, kind }, { status: 401 });
	}
};

// DELETE /api/user/credentials?serviceId=xxx — Unlink a service account
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) return json({ error: 'Missing serviceId parameter' }, { status: 400 });

	const config = getServiceConfig(serviceId);
	const userId = locals.user.id;

	// Fetch all user creds now (needed for both managed cleanup and cascade)
	const allCreds = getUserCredentials(userId);
	const targetCred = allCreds.find((c) => c.serviceId === serviceId);

	// Best-effort: delete managed external account before unlinking
	if (config && targetCred?.managed) {
		const adapter = registry.get(config.type);
		if (adapter && 'deleteUser' in adapter && typeof (adapter as any).deleteUser === 'function') {
			try {
				await (adapter as any).deleteUser(config, targetCred.externalUserId);
			} catch (e) {
				console.warn('[API] managed deleteUser failed (ignored):', e instanceof Error ? e.message : e);
			}
		}
	}

	deleteUserCredential(userId, serviceId);

	// Cascade: remove credentials for services that were linked via this service type
	if (config) {
		for (const c of allCreds) {
			if (c.serviceId !== serviceId && c.linkedVia === config.type) {
				deleteUserCredential(userId, c.serviceId);
			}
		}
	}

	invalidateUserCaches(userId);
	return json({ ok: true });
};
