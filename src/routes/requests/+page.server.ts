import { redirect } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getUserCredentialForService } from '$lib/server/auth';
import { getEnabledConfigs } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import type { NexusRequest, UnifiedMedia } from '$lib/adapters/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login?next=/requests');

	const isAdmin = locals.user.isAdmin;
	const userId = locals.user.id;

	const overseerrConfigs = getEnabledConfigs().filter((c) => c.type === 'overseerr');
	const hasOverseerr = overseerrConfigs.length > 0;

	let hasLinkedOverseerr = false;

	// Check for linked credential (sync — no cache needed)
	for (const config of overseerrConfigs) {
		if (getUserCredentialForService(userId, config.id)) {
			hasLinkedOverseerr = true;
			break;
		}
	}

	// Fast: user's own requests + admin pending (small API calls, cached)
	const [myRequests, adminPending] = await Promise.all([
		hasLinkedOverseerr
			? withCache(`requests:user:${userId}`, 30_000, async () => {
					const reqs: NexusRequest[] = [];
					await Promise.allSettled(
						overseerrConfigs.map(async (config) => {
							const adapter = registry.get('overseerr');
							if (!adapter?.getRequests) return;
							const userCred = getUserCredentialForService(userId, config.id) ?? undefined;
							if (userCred) {
								const r = await adapter.getRequests(config, { filter: 'all', take: 100 }, userCred);
								reqs.push(...r);
							}
						})
					);
					return reqs;
				})
			: Promise.resolve([] as NexusRequest[]),

		isAdmin
			? withCache('requests:admin-pending', 30_000, async () => {
					const pending: NexusRequest[] = [];
					await Promise.allSettled(
						overseerrConfigs.map(async (config) => {
							const adapter = registry.get('overseerr');
							if (!adapter?.getRequests) return;
							const p = await adapter.getRequests(config, { filter: 'pending', take: 100 });
							pending.push(...p);
						})
					);
					return pending;
				})
			: Promise.resolve([] as NexusRequest[])
	]);

	// Slow: discover page — streamed, doesn't block navigation
	async function fetchDiscover() {
		return withCache('requests-page:discover', 120_000, async () => {
			const items: UnifiedMedia[] = [];
			let hasMore = false;
			await Promise.allSettled(
				overseerrConfigs.map(async (config) => {
					const adapter = registry.get('overseerr');
					if (!adapter?.discover) return;
					const cred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;
					const result = await adapter.discover(config, { page: 1 }, cred);
					items.push(...result.items);
					if (result.hasMore) hasMore = true;
				})
			);
			const seen = new Set<string>();
			return {
				items: items.filter((i) => {
					if (seen.has(i.sourceId)) return false;
					seen.add(i.sourceId);
					return true;
				}),
				hasMore
			};
		});
	}

	const byDate = (a: NexusRequest, b: NexusRequest) =>
		new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime();

	return {
		myRequests: myRequests.sort(byDate),
		adminPending: adminPending.sort(byDate),
		// Streamed — page renders immediately, discover fills in
		initialDiscover: fetchDiscover(),
		hasLinkedOverseerr,
		isAdmin,
		hasOverseerr
	};
};
