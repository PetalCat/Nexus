import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';
import { requireActiveUser } from '$lib/server/session-guard';
import type { CalendarItem } from '$lib/adapters/types';

export const GET: RequestHandler = async (event) => {
	const user = requireActiveUser(event);
	const { url } = event;
	const days = Math.min(parseInt(url.searchParams.get('days') ?? '7', 10), 90);
	const typesParam = url.searchParams.get('types');
	const allowedTypes = typesParam ? new Set(typesParam.split(',')) : null;

	const now = new Date();
	const start = now.toISOString();
	const end = new Date(now.getTime() + days * 86_400_000).toISOString();

	// Per-user cache key. Content is sourced from admin-configured Radarr/Sonarr
	// instances so it's currently identical for all users, but keying by user
	// avoids a future repeat of issue #4 if per-user credentials ever diverge.
	const items = await withCache(
		`calendar:${user.id}:${days}:${typesParam ?? 'all'}`,
		300_000,
		async () => {
			const configs = getEnabledConfigs();
			const results: CalendarItem[] = [];

			await Promise.allSettled(
				configs.map(async (config) => {
					const adapter = registry.get(config.type);
					if (!adapter?.getCalendar) return;
					const calItems = await adapter.getCalendar(config, start, end);
					for (const item of calItems) {
						if (!allowedTypes || allowedTypes.has(item.mediaType)) {
							results.push(item);
						}
					}
				})
			);

			return results.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
		}
	);

	return json(items);
};
