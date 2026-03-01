import { json } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import type { ServiceConfig } from '$lib/adapters/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
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
