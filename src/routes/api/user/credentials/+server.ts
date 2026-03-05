import { json } from '@sveltejs/kit';
import { getUserCredentials, getUserCredentialForService, upsertUserCredential, deleteUserCredential } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { getServiceConfig, getServiceConfigs } from '$lib/server/services';
import { importJellyfinUser } from '$lib/adapters/overseerr';
import { invalidatePrefix } from '$lib/server/cache';
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
			linkedAt: c.linkedAt
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
	if (!adapter?.userLinkable) {
		return json({ error: 'This service does not support user-level accounts' }, { status: 400 });
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
				// Validate the Jellyfin token works against StreamyStats
				const jfUrl = (config.username ?? '').replace(/\/+$/, '');
				const testUrl = new URL(`${config.url.replace(/\/+$/, '')}/api/recommendations`);
				testUrl.searchParams.set('serverUrl', jfUrl);
				testUrl.searchParams.set('limit', '1');
				const res = await fetch(testUrl.toString(), {
					headers: { Authorization: `MediaBrowser Token="${jellyfinCred.accessToken}"` },
					signal: AbortSignal.timeout(8000)
				});
				if (!res.ok) {
					return json({ error: `StreamyStats rejected Jellyfin token (${res.status}). Ensure StreamyStats is configured for this Jellyfin server.` }, { status: 400 });
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
	const { username, password } = body;
	if (!username || !password) {
		return json({ error: 'Missing username or password' }, { status: 400 });
	}

	if (!adapter.authenticateUser) {
		return json({ error: 'This service does not support user authentication yet' }, { status: 501 });
	}

	try {
		const result = await adapter.authenticateUser(config, username, password);
		upsertUserCredential(locals.user.id, serviceId, {
			accessToken: result.accessToken,
			externalUserId: result.externalUserId,
			externalUsername: result.externalUsername
		});
		invalidateUserCaches(locals.user.id);
		return json({
			serviceId,
			externalUserId: result.externalUserId,
			externalUsername: result.externalUsername
		});
	} catch (e) {
		// Pass the real error message back — adapter throws with specific messages
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[API] credential link error:', msg);
		return json({ error: msg }, { status: 401 });
	}
};

// DELETE /api/user/credentials?serviceId=xxx — Unlink a service account
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) return json({ error: 'Missing serviceId parameter' }, { status: 400 });

	deleteUserCredential(locals.user.id, serviceId);
	invalidateUserCaches(locals.user.id);
	return json({ ok: true });
};
