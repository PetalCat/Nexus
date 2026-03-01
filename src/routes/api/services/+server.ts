import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import {
	checkAllServices,
	deleteService,
	getServiceConfigs,
	upsertService
} from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const withHealth = url.searchParams.get('health') === 'true';
	const configs = getServiceConfigs();

	if (withHealth) {
		const health = await checkAllServices();
		return json({ services: configs, health });
	}

	// Also return the registry so the frontend knows what types are available
	const available = registry.all().map((a) => ({
		id: a.id,
		displayName: a.displayName,
		defaultPort: a.defaultPort,
		icon: a.icon,
		mediaTypes: a.mediaTypes
	}));

	return json({ services: configs, available });
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		if (!body.id || !body.name || !body.type || !body.url) {
			return json({ error: 'Missing required fields: id, name, type, url' }, { status: 400 });
		}
		upsertService(body);
		return json({ ok: true });
	} catch (e) {
		console.error('[API] services POST error', e);
		return json({ error: 'Failed to save service' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	deleteService(id);
	return json({ ok: true });
};
