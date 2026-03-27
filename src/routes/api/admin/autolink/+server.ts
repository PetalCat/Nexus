import { json } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import { getServiceConfig, autoDiscoverAndLink, autoLinkJellyfinServices } from '$lib/server/services';
import { getAllUsers, getUserCredentialForService, upsertUserCredential } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import type { RequestHandler } from './$types';

// ---------------------------------------------------------------------------
// GET /api/admin/autolink?serviceId=xxx
// Preview discovered external users and their match/link status against Nexus users.
// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) return json({ error: 'Missing serviceId' }, { status: 400 });

	const config = getServiceConfig(serviceId);
	if (!config) return json({ error: 'Service not found' }, { status: 404 });

	const adapter = registry.get(config.type);
	if (!adapter) return json({ error: `No adapter registered for type: ${config.type}` }, { status: 400 });
	if (!adapter.getUsers) return json({ error: `Adapter ${config.type} does not support getUsers` }, { status: 400 });

	const [externalUsers, nexusUsers] = await Promise.all([
		adapter.getUsers(config),
		Promise.resolve(getAllUsers())
	]);

	// Build a map: externalUserId → nexus user (for already-linked users)
	const linkedMap = new Map<string, { nexusUserId: string; nexusUsername: string }>();
	for (const nexusUser of nexusUsers) {
		const cred = getUserCredentialForService(nexusUser.id, serviceId);
		if (cred?.externalUserId) {
			linkedMap.set(cred.externalUserId, {
				nexusUserId: nexusUser.id,
				nexusUsername: nexusUser.username
			});
		}
	}

	// Build a map: lowercase username → nexus user (for auto-match by username)
	const usernameMap = new Map<string, { nexusUserId: string; nexusUsername: string }>();
	for (const nexusUser of nexusUsers) {
		usernameMap.set(nexusUser.username.toLowerCase(), {
			nexusUserId: nexusUser.id,
			nexusUsername: nexusUser.username
		});
	}

	const preview = externalUsers.map((extUser) => {
		const linked = linkedMap.get(extUser.externalId);
		if (linked) {
			return {
				externalId: extUser.externalId,
				externalUsername: extUser.username,
				isAdmin: extUser.isAdmin ?? false,
				status: 'already-linked' as const,
				nexusUsername: linked.nexusUsername,
				nexusUserId: linked.nexusUserId
			};
		}

		const match = usernameMap.get(extUser.username.toLowerCase());
		if (match) {
			return {
				externalId: extUser.externalId,
				externalUsername: extUser.username,
				isAdmin: extUser.isAdmin ?? false,
				status: 'match' as const,
				nexusUsername: match.nexusUsername,
				nexusUserId: match.nexusUserId
			};
		}

		return {
			externalId: extUser.externalId,
			externalUsername: extUser.username,
			isAdmin: extUser.isAdmin ?? false,
			status: 'no-match' as const
		};
	});

	return json(preview);
};

// ---------------------------------------------------------------------------
// POST /api/admin/autolink — Execute auto-linking
// Body: { serviceId: string, mappings?: [{ externalId: string, nexusUserId: string }] }
// ---------------------------------------------------------------------------

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const body = await request.json();
	const { serviceId, mappings } = body as {
		serviceId: string;
		mappings?: Array<{ externalId: string; nexusUserId: string }>;
	};

	if (!serviceId) return json({ error: 'Missing serviceId' }, { status: 400 });

	// No mappings — use auto-discovery by username matching
	if (!mappings || mappings.length === 0) {
		try {
			const results = await autoDiscoverAndLink(serviceId);
			return json({ results });
		} catch (e) {
			console.error('[autolink] autoDiscoverAndLink error', e);
			return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
		}
	}

	// Explicit mappings provided — execute each one
	const config = getServiceConfig(serviceId);
	if (!config) return json({ error: 'Service not found' }, { status: 404 });

	const adapter = registry.get(config.type);
	if (!adapter) return json({ error: `No adapter registered for type: ${config.type}` }, { status: 400 });
	if (!adapter.getUsers) return json({ error: `Adapter ${config.type} does not support getUsers` }, { status: 400 });

	// Fetch external users once so we can resolve username from externalId
	let externalUsers: Awaited<ReturnType<typeof adapter.getUsers>>;
	try {
		externalUsers = await adapter.getUsers!(config);
	} catch (e) {
		return json({ error: `Failed to fetch external users: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
	}

	const extUserMap = new Map(externalUsers.map((u) => [u.externalId, u]));
	const nexusUsers = getAllUsers();
	const nexusUserMap = new Map(nexusUsers.map((u) => [u.id, u]));

	const results = [];

	for (const mapping of mappings) {
		const extUser = extUserMap.get(mapping.externalId);
		const nexusUser = nexusUserMap.get(mapping.nexusUserId);

		if (!extUser) {
			results.push({
				externalId: mapping.externalId,
				nexusUserId: mapping.nexusUserId,
				status: 'error' as const,
				error: 'External user not found'
			});
			continue;
		}

		if (!nexusUser) {
			results.push({
				externalId: mapping.externalId,
				externalUsername: extUser.username,
				nexusUserId: mapping.nexusUserId,
				status: 'error' as const,
				error: 'Nexus user not found'
			});
			continue;
		}

		// Check if already linked
		const existing = getUserCredentialForService(nexusUser.id, serviceId);
		if (existing?.externalUserId === mapping.externalId) {
			results.push({
				externalId: mapping.externalId,
				externalUsername: extUser.username,
				nexusUserId: nexusUser.id,
				nexusUsername: nexusUser.username,
				status: 'already-linked' as const
			});
			continue;
		}

		try {
			if (adapter.resetPassword && adapter.authenticateUser) {
				const tempPw = randomBytes(24).toString('base64url');
				await adapter.resetPassword(config, extUser.externalId, tempPw);
				const cred = await adapter.authenticateUser(config, extUser.username, tempPw);
				upsertUserCredential(nexusUser.id, serviceId, cred);

				// Cascade dependent service links (e.g. Overseerr via Jellyfin token)
				await autoLinkJellyfinServices(nexusUser.id);

				results.push({
					externalId: mapping.externalId,
					externalUsername: extUser.username,
					nexusUserId: nexusUser.id,
					nexusUsername: nexusUser.username,
					status: 'linked' as const
				});
			} else {
				// Adapter supports getUsers but not reset/auth — store by ID only if possible
				results.push({
					externalId: mapping.externalId,
					externalUsername: extUser.username,
					nexusUserId: nexusUser.id,
					nexusUsername: nexusUser.username,
					status: 'error' as const,
					error: 'Adapter does not support password reset or authentication'
				});
			}
		} catch (e) {
			results.push({
				externalId: mapping.externalId,
				externalUsername: extUser.username,
				nexusUserId: nexusUser.id,
				nexusUsername: nexusUser.username,
				status: 'error' as const,
				error: e instanceof Error ? e.message : String(e)
			});
		}
	}

	return json({ results });
};
