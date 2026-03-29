import { getDashboardFast, getEnabledConfigs } from '$lib/server/services';
import { getHomepageCache, buildHomepageCache, applyRowOrder, cwToItem, homepageImage } from '$lib/server/homepage-cache';
import type { HomepageRow, HomepageItem, HeroItem, HomepageCache } from '$lib/server/homepage-cache';
import { withCache } from '$lib/server/cache';
import { getRecommendations } from '$lib/server/recommendations/aggregator';
import { getRawDb } from '$lib/db';
import type { CalendarItem } from '$lib/adapters/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const userId = locals.user?.id;
	const hasServices = getEnabledConfigs().length > 0;

	// Parallel: live Continue Watching + pre-computed homepage cache + calendar + upcoming
	const [dashboardRows, homepageCache, calendarRes, upcomingMoviesRes, upcomingTvRes] = await Promise.all([
		getDashboardFast(userId),
		userId ? getHomepageCache(userId) : Promise.resolve(null),
		fetch('/api/calendar?days=7').then((r) => (r.ok ? r.json() : [])).catch(() => []),
		fetch('/api/discover?category=upcoming-movies&page=1').then((r) => (r.ok ? r.json() : null)).catch(() => null),
		fetch('/api/discover?category=upcoming-tv&page=1').then((r) => (r.ok ? r.json() : null)).catch(() => null)
	]);
	const calendarItems: CalendarItem[] = calendarRes;

	// Build upcoming rows from discover API
	const upcomingRows: HomepageRow[] = [];
	if (upcomingMoviesRes?.items?.length > 0) {
		upcomingRows.push({
			id: 'upcoming-movies',
			title: 'Upcoming Movies',
			subtitle: 'New releases coming soon',
			type: 'system',
			items: upcomingMoviesRes.items.slice(0, 20).map((item: any): HomepageItem => ({
				id: item.id,
				sourceId: item.sourceId,
				serviceId: item.serviceId,
				serviceType: item.serviceType,
				title: item.title,
				poster: item.poster,
				backdrop: item.backdrop,
				year: item.year,
				mediaType: item.type ?? 'movie',
				rating: item.rating,
				genres: item.genres,
				description: item.description
			}))
		});
	}
	if (upcomingTvRes?.items?.length > 0) {
		upcomingRows.push({
			id: 'upcoming-tv',
			title: 'Upcoming Shows',
			subtitle: 'New seasons and premieres',
			type: 'system',
			items: upcomingTvRes.items.slice(0, 20).map((item: any): HomepageItem => ({
				id: item.id,
				sourceId: item.sourceId,
				serviceId: item.serviceId,
				serviceType: item.serviceType,
				title: item.title,
				poster: item.poster,
				backdrop: item.backdrop,
				year: item.year,
				mediaType: item.type ?? 'show',
				rating: item.rating,
				genres: item.genres,
				description: item.description
			}))
		});
	}

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

		// Inject New in Library + upcoming into the cached rows
		const allRows = [...homepageCache.rows, ...upcomingRows];
		if (newRow) allRows.push(newRow);

		const orderedRows = applyRowOrder(allRows, rowOrder);
		if (continueRow) orderedRows.unshift(continueRow);

		return {
			hero: homepageCache.hero,
			rows: orderedRows,
			personalized: true,
			hasServices,
			calendarItems
		};
	}

	// No in-memory cache — try a fast DB-backed build only.
	if (userId) {
		const eagerCache = buildHomepageCache(userId);

		if (eagerCache && eagerCache.rows.length > 0) {
			// Store it so subsequent loads are instant
			withCache(`homepage:${userId}`, 60 * 60 * 1000, async () => eagerCache);

			const allRows = [...eagerCache.rows, ...upcomingRows];
			if (newRow) allRows.push(newRow);
			const orderedRows = applyRowOrder(allRows);
			if (continueRow) orderedRows.unshift(continueRow);

			return {
				hero: eagerCache.hero,
				rows: orderedRows,
				personalized: true,
				hasServices,
				calendarItems
			};
		}

		// Cold cache: compute recommendations in the background instead of blocking the page.
		void Promise.allSettled([
			getRecommendations(userId, 'movie', 30),
			getRecommendations(userId, 'show', 30),
			getRecommendations(userId, 'book', 20),
			getRecommendations(userId, 'game', 20)
		]).then(() => {
			const rebuilt = buildHomepageCache(userId);
			if (!rebuilt || rebuilt.rows.length === 0) return;
			void withCache(`homepage:${userId}`, 60 * 60 * 1000, async () => rebuilt);
		}).catch(() => {});
	}

	// True cold start — no recommendation data at all
	const coldRows: HomepageRow[] = [];
	if (continueRow) coldRows.push(continueRow);
	if (newRow) coldRows.push(newRow);
	coldRows.push(...upcomingRows);

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
				backdrop: homepageImage(heroSource.backdrop, heroSource.serviceId, 'hero-backdrop'),
				poster: homepageImage(heroSource.poster, heroSource.serviceId, 'poster'),
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
		personalized: false,
		hasServices,
		calendarItems
	};
};
