import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigsForMediaType } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { withCache } from '$lib/server/cache';
import { buildCompositeId, parseCompositeId } from '$lib/shared/ids';

/** GET /api/live/guide?channelId=xxx — single channel schedule (24h) */
/** GET /api/live/guide — all channels guide (4h), merged across every live-TV config */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const channelId = url.searchParams.get('channelId');
	const liveConfigs = getConfigsForMediaType('live');

	if (liveConfigs.length === 0) {
		return json({ guide: channelId ? [] : {} });
	}

	// Single-channel path: parse composite ID, dispatch to owning adapter.
	if (channelId) {
		const parsed = parseCompositeId(channelId);
		const targetServiceId = parsed?.serviceId;
		const rawSourceId = parsed?.sourceId ?? channelId;
		const config = targetServiceId
			? liveConfigs.find((c) => c.id === targetServiceId)
			: liveConfigs[0];
		if (!config) {
			return json({ guide: [] });
		}
		const adapter = registry.get(config.type);
		const userCred = getUserCredentialForService(locals.user.id, config.id) ?? undefined;
		const programs = await withCache(
			`live:guide:${config.id}:${rawSourceId}:${locals.user.id}`,
			120_000,
			() =>
				adapter?.getServiceData?.(config, 'programs', { channelId: rawSourceId }, userCred) ??
				Promise.resolve([])
		);
		return json({ guide: programs });
	}

	// All-channels path: fan out across every live-TV config, merge keyed by
	// composite `${serviceId}:${sourceId}` so HDHomeRun-style integer channel
	// IDs don't collide across servers.
	const userId = locals.user.id;
	const results = await Promise.allSettled(
		liveConfigs.map(async (config) => {
			const adapter = registry.get(config.type);
			const userCred = getUserCredentialForService(userId, config.id) ?? undefined;
			const guide = (await withCache(
				`live:guide:all:${config.id}:${userId}`,
				120_000,
				() => adapter?.getServiceData?.(config, 'tv-guide', {}, userCred) ?? Promise.resolve({})
			)) as Record<string, unknown[]> | null;
			return { serviceId: config.id, guide: guide ?? {} };
		})
	);

	const merged: Record<string, unknown[]> = {};
	for (const r of results) {
		if (r.status !== 'fulfilled') continue;
		const { serviceId, guide } = r.value;
		for (const [sourceId, programs] of Object.entries(guide)) {
			merged[buildCompositeId(serviceId, sourceId)] = programs as unknown[];
		}
	}

	return json({ guide: merged });
};
