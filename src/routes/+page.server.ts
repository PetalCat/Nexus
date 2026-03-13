import { getDashboardFast } from '$lib/server/services';
import { getHomepageCache, buildHomepageCache, applyRowOrder, cwToItem } from '$lib/server/homepage-cache';
import type { HomepageRow, HomepageItem, HeroItem, HomepageCache } from '$lib/server/homepage-cache';
import { withCache } from '$lib/server/cache';
import { getRecommendations } from '$lib/server/recommendations/aggregator';
import { getRawDb } from '$lib/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;

	// Parallel: live Continue Watching + pre-computed homepage cache
	const [dashboardRows, homepageCache] = await Promise.all([
		getDashboardFast(userId),
		userId ? getHomepageCache(userId) : Promise.resolve(null)
	]);

	// Build Continue Watching row from live data
	const cwDashRow = dashboardRows.find((r) => r.id === 'continue');
	const cwItems: HomepageItem[] = (cwDashRow?.items ?? []).map(cwToItem);
	const continueRow: HomepageRow | null = cwItems.length > 0
		? { id: 'continue', title: 'Continue Watching', type: 'system', items: cwItems }
		: null;

	// New in Library from live data (used in both cache-hit and cold-start paths)
	const newDashRow = dashboardRows.find((r) => r.id === 'new-in-library');
	const newRow: HomepageRow | null = newDashRow
		? {
				id: 'new',
				title: 'New in Your Library',
				subtitle: 'Recently added across your media servers',
				type: 'system',
				items: newDashRow.items.map(cwToItem)
			}
		: null;

	if (homepageCache) {
		// Cache hit — full personalized homepage
		let rowOrder: string[] | undefined;
		if (userId) {
			const raw = getRawDb();
			const profileRow = raw.prepare(
				`SELECT config FROM user_rec_profiles WHERE user_id = ? AND is_default = 1 LIMIT 1`
			).get(userId) as { config: string } | undefined;
			if (profileRow?.config) {
				try {
					const config = JSON.parse(profileRow.config);
					rowOrder = config.rowOrder;
				} catch { /* use default */ }
			}
		}

		// Inject New in Library into the cached rows
		const allRows = [...homepageCache.rows];
		if (newRow) allRows.push(newRow);

		const orderedRows = applyRowOrder(allRows, rowOrder);
		if (continueRow) orderedRows.unshift(continueRow);

		return {
			hero: homepageCache.hero,
			rows: orderedRows,
			personalized: true
		};
	}

	// No cache — try an eager build
	if (userId) {
		// First try: read from existing recommendation_cache DB entries
		let eagerCache = buildHomepageCache(userId);

		// If DB cache is also empty, trigger a fresh recommendation compute
		// This is a one-time cost on first load; subsequent loads use the cache
		if (!eagerCache || eagerCache.rows.length === 0) {
			try {
				await Promise.allSettled([
					getRecommendations(userId, 'movie', 30),
					getRecommendations(userId, 'show', 30),
					getRecommendations(userId, 'book', 20),
					getRecommendations(userId, 'game', 20)
				]);
				eagerCache = buildHomepageCache(userId);
			} catch { /* fall through to cold start */ }
		}

		if (eagerCache && eagerCache.rows.length > 0) {
			// Store it so subsequent loads are instant
			withCache(`homepage:${userId}`, 60 * 60 * 1000, async () => eagerCache);

			const allRows = [...eagerCache.rows];
			if (newRow) allRows.push(newRow);
			const orderedRows = applyRowOrder(allRows);
			if (continueRow) orderedRows.unshift(continueRow);

			return {
				hero: eagerCache.hero,
				rows: orderedRows,
				personalized: true
			};
		}
	}

	// True cold start — no recommendation data at all
	const coldRows: HomepageRow[] = [];
	if (continueRow) coldRows.push(continueRow);
	if (newRow) coldRows.push(newRow);

	const heroSource = cwDashRow?.items[0] ?? newDashRow?.items[0];
	const coldHero: HeroItem[] = heroSource?.backdrop
		? [{
				id: heroSource.id,
				sourceId: heroSource.sourceId,
				serviceId: heroSource.serviceId,
				serviceType: heroSource.serviceType,
				title: heroSource.title,
				year: heroSource.year,
				runtime: heroSource.duration
					? `${Math.floor(heroSource.duration / 3600)}h ${Math.floor((heroSource.duration % 3600) / 60)}m`
					: undefined,
				rating: heroSource.rating,
				overview: heroSource.description,
				backdrop: heroSource.backdrop,
				poster: heroSource.poster,
				mediaType: heroSource.type,
				genres: heroSource.genres,
				reason: '',
				provider: '',
				streamUrl: heroSource.streamUrl
			}]
		: [];

	return {
		hero: coldHero,
		rows: coldRows,
		personalized: false
	};
};
