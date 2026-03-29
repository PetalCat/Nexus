import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const statusFilter = url.searchParams.get('status') ?? 'all';

	const items = await withCache(`admin-downloads:${statusFilter}`, 10_000, async () => {
		const configs = getEnabledConfigs();
		const all: any[] = [];

		await Promise.allSettled(
			configs.map(async (config) => {
				const adapter = registry.get(config.type);
				if (!adapter?.getQueue) return;
				const queue = await adapter.getQueue(config);
				for (const item of queue) {
					item.metadata = { ...item.metadata, serviceName: config.name, serviceId: config.id };
					all.push(item);
				}
			})
		);

		return all.sort((a, b) => {
			const aFailed = a.metadata?.queueStatus === 'failed' ? 0 : 1;
			const bFailed = b.metadata?.queueStatus === 'failed' ? 0 : 1;
			if (aFailed !== bFailed) return aFailed - bFailed;
			return (b.metadata?.downloadProgress ?? 0) - (a.metadata?.downloadProgress ?? 0);
		}).filter((item) => {
			if (statusFilter === 'all') return true;
			if (statusFilter === 'active') return ['downloading', 'queued', 'paused'].includes(item.metadata?.queueStatus);
			if (statusFilter === 'failed') return item.metadata?.queueStatus === 'failed';
			return true;
		});
	});

	return json(items);
};
