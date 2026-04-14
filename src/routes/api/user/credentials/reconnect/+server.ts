/**
 * POST /api/user/credentials/reconnect
 *
 * Manually reconnect a stale credential using the stored password. Called
 * from the StaleCredentialBanner component's "Reconnect" button.
 *
 * Body: { serviceId: string }
 * Returns: 200 { success: true } | 4xx { success: false, kind, message }
 */

import { json } from '@sveltejs/kit';
import { getServiceConfig } from '$lib/server/services';
import { reconnectCredential } from '$lib/adapters/registry-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ success: false, kind: 'unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const serviceId = body?.serviceId as string | undefined;
	if (!serviceId) {
		return json({ success: false, kind: 'bad-request', message: 'Missing serviceId' }, { status: 400 });
	}

	const config = getServiceConfig(serviceId);
	if (!config) {
		return json({ success: false, kind: 'not-found', message: 'Service not found' }, { status: 404 });
	}

	const result = await reconnectCredential(config, locals.user.id);
	if (result.success) return json(result);
	return json(result, { status: 400 });
};
