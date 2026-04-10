import { registry } from '$lib/adapters/registry';
import { getEnabledConfigs, needsAutoLink, autoLinkJellyfinServices } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import { getUnreadCount } from '$lib/server/notifications';
import { getDb, schema } from '$lib/db';
import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';


export const load: LayoutServerLoad = async ({ locals }) => {
	// Silently wire up Overseerr (and future Jellyfin-auth services) in the background.
	// The guard is a fast synchronous DB check — only fires async work when needed.
	if (locals.user && needsAutoLink(locals.user.id)) {
		autoLinkJellyfinServices(locals.user.id).catch(() => {});
	}

	// Notifications count is a fast sync DB query — safe to await
	let unreadNotifications = 0;
	if (locals.user) {
		unreadNotifications = getUnreadCount(locals.user.id);
	}

	// Autoplay trailers preference — defaults to true (desktop overrides to false on mobile client-side)
	let autoplayTrailers = true;
	if (locals.user) {
		const db = getDb();
		const setting = db
			.select({ value: schema.appSettings.value })
			.from(schema.appSettings)
			.where(eq(schema.appSettings.key, `user:${locals.user.id}:autoplayTrailers`))
			.get();
		if (setting) autoplayTrailers = setting.value === 'true';
	}

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
		autoplayTrailers,
		// Streamed — never blocks page navigation
		pendingRequests: fetchPendingRequests(),
	};
};
