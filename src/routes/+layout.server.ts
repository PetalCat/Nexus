import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs, needsAutoLink, autoLinkJellyfinServices } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	let pendingRequests = 0;

	if (locals.user?.isAdmin) {
		// Use the fast /request/count endpoint — no TMDB enrichment, no pagination
		// Cache for 30s so rapid navigation doesn't hammer Overseerr
		const overseerrConfigs = getEnabledConfigs().filter((c) => c.type === 'overseerr');
		const counts = await Promise.allSettled(
			overseerrConfigs.map((config) =>
				withCache(`pending-count:${config.id}`, 30_000, async () => {
					const adapter = registry.get('overseerr');
					return (await adapter?.getPendingCount?.(config)) ?? 0;
				})
			)
		);
		pendingRequests = counts.reduce(
			(sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0),
			0
		);
	}

	// Silently wire up Overseerr (and future Jellyfin-auth services) in the background.
	// The guard is a fast synchronous DB check — only fires async work when needed.
	if (locals.user && needsAutoLink(locals.user.id)) {
		autoLinkJellyfinServices(locals.user.id).catch(() => {});
	}

	return { user: locals.user ?? null, pendingRequests };
};
