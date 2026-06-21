import { redirect } from '@sveltejs/kit';
import { registry } from '$lib/adapters/registry';
import { getUserCredentialForService } from '$lib/server/auth';
import { getEnabledConfigs } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import { getNativeRequests, nativeToNexusRequest } from '$lib/server/media-requests';
import type { NexusRequest, UnifiedMedia } from '$lib/adapters/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login?next=/requests');

	const isAdmin = locals.user.isAdmin;
	const userId = locals.user.id;

	const overseerrConfigs = getEnabledConfigs().filter((c) => {
		const adapter = registry.get(c.type);
		return !!adapter?.getRequests;
	});
	const hasOverseerr = overseerrConfigs.length > 0;

	let hasLinkedOverseerr = false;

	// Check for linked credential (sync — no cache needed)
	for (const config of overseerrConfigs) {
		if (getUserCredentialForService(userId, config.id)) {
			hasLinkedOverseerr = true;
			break;
		}
	}

	// Fast: user's own requests + admin all requests (small API calls, cached)
	const [myRequests, allRequests] = await Promise.all([
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
			? withCache('requests:admin-all', 30_000, async () => {
					const all: NexusRequest[] = [];
					await Promise.allSettled(
						overseerrConfigs.map(async (config) => {
							const adapter = registry.get('overseerr');
							if (!adapter?.getRequests) return;
							const r = await adapter.getRequests(config, { filter: 'all', take: 100 });
							all.push(...r);
						})
					);
					return all;
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

	// Native media_requests rows (the no-Overseerr path) — read live (local DB).
	const nativeMine = getNativeRequests({ userId, isAdmin: false }).map(nativeToNexusRequest);
	const nativeAll = isAdmin
		? getNativeRequests({ userId, isAdmin: true }).map(nativeToNexusRequest)
		: [];

	// Merge native + Overseerr, deduped by (tmdbId|sourceId, type). Native wins.
	const mergeRequests = (native: NexusRequest[], overseerr: NexusRequest[]): NexusRequest[] => {
		const out = [...native];
		const seen = new Set(native.map((r) => `${r.tmdbId ?? r.sourceId}:${r.type}`));
		for (const r of overseerr) {
			const key = `${r.tmdbId ?? r.sourceId}:${r.type}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(r);
		}
		return out;
	};

	return {
		myRequests: mergeRequests(nativeMine, myRequests).sort(byDate),
		allRequests: mergeRequests(nativeAll, allRequests).sort(byDate),
		initialDiscover: fetchDiscover(),
		hasLinkedOverseerr,
		isAdmin,
		hasOverseerr
	};
};
