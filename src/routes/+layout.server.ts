import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs, needsAutoLink, autoLinkJellyfinServices } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import { getUnreadCount } from '$lib/server/notifications';
import { getUnseenShareCount } from '$lib/server/social';
import { getAutoplayTrailers, getAutoplayNext } from '$lib/server/user-prefs';
import type { LayoutServerLoad } from './$types';


export const load: LayoutServerLoad = async ({ locals }) => {
	// Silently wire up Overseerr (and future Jellyfin-auth services) in the background.
	// The guard is a fast synchronous DB check — only fires async work when needed.
	if (locals.user && needsAutoLink(locals.user.id)) {
		autoLinkJellyfinServices(locals.user.id).catch(() => {});
	}

	// Notifications count is a fast sync DB query — safe to await
	let unreadNotifications = 0;
	let unseenShares = 0;
	if (locals.user) {
		unreadNotifications = getUnreadCount(locals.user.id);
		// Unseen-share count is a fast sync COUNT(*) — needed by NavSidebar on every page,
		// so we lift it to the root layout (was previously only loaded under /library/*).
		unseenShares = getUnseenShareCount(locals.user.id);
	}

	// Autoplay preferences — both routed through the canonical reader helper
	// in $lib/server/user-prefs so defaults + storage coercion live in one
	// place. See that file's header for the consumer list.
	const autoplayTrailers = locals.user ? getAutoplayTrailers(locals.user.id) : true;
	const autoplayNext = locals.user ? getAutoplayNext(locals.user.id) : false;

	// Pending request count — streamed, NEVER blocks navigation
	async function fetchPendingRequests(): Promise<number> {
		if (!locals.user?.isAdmin) return 0;
		const overseerrConfigs = getEnabledConfigs().filter((c) => {
			const adapter = registry.get(c.type);
			return !!adapter?.getRequests;
		});
		const counts = await Promise.allSettled(
			overseerrConfigs.map((config) =>
				withCache(`pending-count:${config.id}`, 30_000, async () => {
					const adapter = registry.get('overseerr');
					return (await adapter?.getPendingCount?.(config)) ?? 0;
				})
			)
		);
		return counts.reduce(
			(sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0),
			0
		);
	}

	return {
		user: locals.user ?? null,
		unreadNotifications,
		unseenShares,
		autoplayTrailers,
		autoplayNext,
		// Streamed — never blocks page navigation
		pendingRequests: fetchPendingRequests(),
	};
};
