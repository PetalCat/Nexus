import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth } from './types';

async function prowlarrFetch(config: ServiceConfig, path: string) {
	const url = new URL(`${config.url}/api/v1${path}`);
	url.searchParams.set('apikey', config.apiKey ?? '');
	const res = await fetch(url.toString());
	if (!res.ok) throw new Error(`Prowlarr ${path} → ${res.status}`);
	return res.json();
}

export const prowlarrAdapter: ServiceAdapter = {
	id: 'prowlarr',
	displayName: 'Prowlarr',
	defaultPort: 9696,
	icon: 'prowlarr',
	mediaTypes: ['other'],

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await prowlarrFetch(config, '/system/status');
			return {
				serviceId: config.id,
				name: config.name,
				type: 'prowlarr',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'prowlarr',
				online: false,
				error: String(e)
			};
		}
	}
};
