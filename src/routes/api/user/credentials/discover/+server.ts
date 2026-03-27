import { json } from '@sveltejs/kit';
import { getServiceConfig } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// GET /api/user/credentials/discover?serviceId=xxx
// Returns unclaimed external users on the service (not yet linked to any Nexus user).
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) return json({ error: 'Missing serviceId parameter' }, { status: 400 });

	const config = getServiceConfig(serviceId);
	if (!config) return json({ error: 'Service not found' }, { status: 404 });

	const adapter = registry.get(config.type);
	if (!adapter?.userLinkable || !adapter?.getUsers || !adapter?.resetPassword || !adapter?.authenticateUser) {
		return json({ error: 'This service does not support user account picking' }, { status: 400 });
	}

	try {
		const users = await adapter.getUsers(config);

		// Find all externalUserIds already claimed for this service
		const db = getDb();
		const allCreds = db
			.select({ externalUserId: schema.userServiceCredentials.externalUserId })
			.from(schema.userServiceCredentials)
			.where(eq(schema.userServiceCredentials.serviceId, serviceId))
			.all();
		const claimedIds = new Set(allCreds.map((c) => c.externalUserId).filter(Boolean));

		// Return only unclaimed users
		const unclaimed = users
			.filter((u) => !claimedIds.has(u.externalId))
			.map((u) => ({
				externalId: u.externalId,
				username: u.username,
				isAdmin: u.isAdmin ?? false
			}));

		return json(unclaimed);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return json({ error: msg }, { status: 500 });
	}
};
