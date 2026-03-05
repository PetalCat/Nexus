import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import {
	checkAllServices,
	deleteService,
	getServiceConfigs,
	upsertService
} from '$lib/server/services';
import { invalidatePrefix } from '$lib/server/cache';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Admin required' }, { status: 403 });

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

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Admin required' }, { status: 403 });

	try {
		const body = await request.json();
		if (!body.id || !body.name || !body.type || !body.url) {
			return json({ error: 'Missing required fields: id, name, type, url' }, { status: 400 });
		}
		upsertService(body);
		// Service config changed — invalidate everything that depends on services
		invalidatePrefix('health');
		invalidatePrefix('recently-added');
		invalidatePrefix('trending');
		invalidatePrefix('discover:');
		invalidatePrefix('library:');
		invalidatePrefix('live-channels:');
		invalidatePrefix('queue');
		return json({ ok: true });
	} catch (e) {
		console.error('[API] services POST error', e);
		return json({ error: 'Failed to save service' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Admin required' }, { status: 403 });

	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Missing id' }, { status: 400 });
	deleteService(id);
	// Service removed — invalidate everything
	invalidatePrefix('health');
	invalidatePrefix('recently-added');
	invalidatePrefix('trending');
	invalidatePrefix('discover:');
	invalidatePrefix('library:');
	invalidatePrefix('live-channels:');
	invalidatePrefix('queue');
	invalidatePrefix('pending-count:');
	invalidatePrefix('api-requests:');
	invalidatePrefix('requests:');
	invalidatePrefix('admin-');
	return json({ ok: true });
};
