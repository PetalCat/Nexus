import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getServiceConfig } from '$lib/server/services';
import type { RequestHandler } from './$types';

// GET /api/media?serviceId=xxx&sourceId=yyy
export const GET: RequestHandler = async ({ url }) => {
	const serviceId = url.searchParams.get('serviceId');
	const sourceId = url.searchParams.get('sourceId');

	if (!serviceId || !sourceId) {
		return json({ error: 'Missing serviceId or sourceId' }, { status: 400 });
	}

	const config = getServiceConfig(serviceId);
	if (!config) return json({ error: 'Service not found' }, { status: 404 });

	const adapter = registry.get(config.type);
	if (!adapter?.getItem) {
		return json({ error: 'Adapter does not support item fetch' }, { status: 501 });
	}

	try {
		const item = await adapter.getItem(config, sourceId);
		if (!item) return json({ error: 'Item not found' }, { status: 404 });
		return json(item);
	} catch (e) {
		console.error('[API] media GET error', e);
		return json({ error: 'Failed to fetch item' }, { status: 500 });
	}
};
