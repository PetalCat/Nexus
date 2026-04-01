import { json, error } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService, upsertUserCredential, getUserById } from '$lib/server/auth';
import { randomBytes } from 'crypto';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401);
	const { serviceId } = params;
	const config = getServiceConfig(serviceId);
	if (!config) throw error(404, 'Service not found');
	const adapter = registry.get(config.type);
	if (!adapter?.createUser) throw error(400, 'Service does not support account creation');

	// Check if already linked
	const existing = getUserCredentialForService(locals.user.id, serviceId);
	if (existing?.accessToken || existing?.externalUserId) {
		throw error(409, 'Already linked to this service');
	}

	const user = getUserById(locals.user.id);
	if (!user) throw error(401);

	// Generate a managed password the user never sees
	const managedPassword = randomBytes(24).toString('base64url');

	try {
		const result = await adapter.createUser(config, user.username, managedPassword);
		upsertUserCredential(locals.user.id, serviceId, {
			accessToken: result.accessToken,
			externalUserId: result.externalUserId,
			externalUsername: result.externalUsername
		}, { managed: true });
		return json({ success: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Failed to create account';
		throw error(500, msg);
	}
};
