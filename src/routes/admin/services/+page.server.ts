import type { PageServerLoad } from './$types';
import { getEnabledConfigs, getQueue, getServiceConfigs } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';
import { getProwlarrIndexers, getProwlarrStats } from '$lib/adapters/prowlarr';

export const load: PageServerLoad = async () => {
	const services = getServiceConfigs();
	const available = registry.all().map((a) => ({
		id: a.id,
		displayName: a.displayName,
		defaultPort: a.defaultPort,
		supportsGetUsers: !!a.getUsers,
		userLinkable: !!a.userLinkable
	}));

	const overseerrConfigs = getEnabledConfigs().filter((c) => c.type === 'overseerr');
	const prowlarrConfigs = getEnabledConfigs().filter((c) => c.type === 'prowlarr');
	const hasInvidious = getEnabledConfigs().some((c) => c.type === 'invidious');

	const [requestsResult, queueResult, prowlarrResult, proxyResult] = await Promise.allSettled([
		// Recent requests across all Overseerr instances
		withCache('admin-requests', 30_000, () =>
			Promise.all(
				overseerrConfigs.map((config) => {
					const adapter = registry.get('overseerr');
					return (
						adapter?.getRequests?.(config, { filter: 'all', take: 12 }) ?? Promise.resolve([])
					);
				})
			).then((all) => all.flat().slice(0, 20))
		),

		// Download queue from *arr services
		withCache('admin-queue', 30_000, () => getQueue()),

		// Prowlarr indexer stats
		withCache('admin-prowlarr', 30_000, async () => {
			if (prowlarrConfigs.length === 0) return null;
			const config = prowlarrConfigs[0];
			const [indexers, stats] = await Promise.all([
				getProwlarrIndexers(config),
				getProwlarrStats(config)
			]);
			return { indexers, stats };
		}),

		// Stream proxy stats (Rust sub-server on port 3939)
		withCache('admin-proxy-stats', 10_000, async () => {
			if (!hasInvidious) return null;
			try {
				const res = await fetch('http://localhost:3939/stats', { signal: AbortSignal.timeout(3000) });
				if (!res.ok) return null;
				return await res.json();
			} catch {
				return null;
			}
		})
	]);

	return {
		services,
		available,
		requests: requestsResult.status === 'fulfilled' ? requestsResult.value : [],
		queue: queueResult.status === 'fulfilled' ? queueResult.value : [],
		prowlarr: prowlarrResult.status === 'fulfilled' ? prowlarrResult.value : null,
		proxyStats: proxyResult.status === 'fulfilled' ? proxyResult.value : null
	};
};
