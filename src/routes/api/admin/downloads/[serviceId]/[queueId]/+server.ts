import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceConfigs } from '$lib/server/services';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const { serviceId, queueId } = params;
	const config = getServiceConfigs().find((s) => s.id === serviceId);
	if (!config) return json({ error: 'Service not found' }, { status: 404 });

	const body = await request.json();
	const action = body.action as string;
	if (!['retry', 'remove', 'blocklist'].includes(action)) {
		return json({ error: 'Unknown action' }, { status: 400 });
	}

	const apiVersion = config.type === 'lidarr' ? 'v1' : 'v3';
	const url = new URL(`${config.url}/api/${apiVersion}/queue/${queueId}`);
	url.searchParams.set('apikey', config.apiKey ?? '');
	url.searchParams.set('removeFromClient', 'true');
	url.searchParams.set('blocklist', action === 'blocklist' ? 'true' : 'false');

	try {
		const res = await fetch(url.toString(), { method: 'DELETE', signal: AbortSignal.timeout(8000) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return json({ success: true });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
	}
};
