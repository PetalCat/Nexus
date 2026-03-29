import { getLibraryItems, getConfigsForMediaType } from '$lib/server/services';
import { getPlatforms } from '$lib/adapters/romm';
import { getUserCredentialForService } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	const rommConfigs = getConfigsForMediaType('game');

	const [libraryResult, ...platformResults] = await Promise.all([
		getLibraryItems({ type: 'game', limit: 2000 }, userId),
		...rommConfigs.map((c) => {
			const cred = userId ? getUserCredentialForService(userId, c.id) ?? undefined : undefined;
			return getPlatforms(c, cred);
		})
	]);

	const items = libraryResult.items;
	const platforms = platformResults.flat();

	// Platform breakdown
	const platformMap = new Map<string, { name: string; slug: string; count: number; logo?: string }>();
	for (const item of items) {
		const pName = (item.metadata?.platform as string) ?? 'Unknown';
		const pSlug = (item.metadata?.platformSlug as string) ?? 'unknown';
		const existing = platformMap.get(pName);
		if (existing) {
			existing.count++;
		} else {
			const pInfo = platforms.find((p) => p.slug === pSlug);
			platformMap.set(pName, { name: pName, slug: pSlug, count: 1, logo: pInfo?.url_logo });
		}
	}
	const platformBreakdown = [...platformMap.values()].sort((a, b) => b.count - a.count);

	// Status breakdown
	const statusMap = new Map<string, number>();
	for (const item of items) {
		const status = (item.metadata?.userStatus as string) ?? 'unset';
		statusMap.set(status, (statusMap.get(status) ?? 0) + 1);
	}
	const statusBreakdown = [...statusMap.entries()]
		.map(([status, count]) => ({ status, count }))
		.sort((a, b) => b.count - a.count);

	// Genre breakdown
	const genreMap = new Map<string, number>();
	for (const item of items) {
		for (const g of item.genres ?? []) {
			genreMap.set(g, (genreMap.get(g) ?? 0) + 1);
		}
	}
	const genreBreakdown = [...genreMap.entries()]
		.map(([genre, count]) => ({ genre, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 15);

	// Top rated
	const topRated = items
		.filter((i) => i.rating != null && i.rating > 0)
		.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
		.slice(0, 10);

	// Averages
	let ratingSum = 0;
	let ratingCount = 0;
	for (const item of items) {
		if (item.rating) { ratingSum += item.rating; ratingCount++; }
	}

	const finishedCount = items.filter((i) =>
		i.metadata?.userStatus === 'finished' || i.metadata?.userStatus === 'completed'
	).length;

	return {
		totalGames: items.length,
		avgRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
		finishedCount,
		completionRate: items.length > 0 ? Math.round((finishedCount / items.length) * 100) : 0,
		platformBreakdown,
		statusBreakdown,
		genreBreakdown,
		topRated
	};
};
