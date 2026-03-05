import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getServiceConfig } from '$lib/server/services';
import type { ServiceConfig } from '$lib/adapters/types';
import type { RequestHandler } from './$types';

/** GET /api/services/ping?id=xxx — ping an already-saved service by ID */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	const id = url.searchParams.get('id');
	if (!id) return json({ online: false, error: 'Missing id' }, { status: 400 });
	const config = getServiceConfig(id);
	if (!config) return json({ online: false, error: 'Service not found' }, { status: 404 });
	const adapter = registry.get(config.type);
	if (!adapter) return json({ online: false, error: `No adapter for type "${config.type}"` });
	try {
		const result = await adapter.ping(config);
		return json(result);
	} catch (e) {
		return json({ online: false, error: String(e) });
	}
};

/** POST /api/services/ping — ping an unsaved service config (used when adding/editing) */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ online: false, error: 'Admin required' }, { status: 403 });

	try {
		const config: ServiceConfig = await request.json();
		const adapter = registry.get(config.type);
		if (!adapter) {
			return json({ online: false, error: `No adapter for type "${config.type}"` });
		}
		const result = await adapter.ping(config);
		return json(result);
	} catch (e) {
		return json({ online: false, error: String(e) });
	}
};
