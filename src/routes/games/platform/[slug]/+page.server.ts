import { getLibraryItems, getEnabledConfigs } from '$lib/server/services';
import { getPlatforms } from '$lib/adapters/romm';
import { getUserCredentialForService } from '$lib/server/auth';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const sortBy = url.searchParams.get('sort') || 'title';
	const userId = locals.user?.id;
	const rommConfigs = getEnabledConfigs().filter((c) => c.type === 'romm');
	if (rommConfigs.length === 0) throw error(404, 'No RomM service configured');

	const config = rommConfigs[0];
	const userCred = userId ? getUserCredentialForService(userId, config.id) ?? undefined : undefined;
	const platforms = await getPlatforms(config, userCred);
	const platform = platforms.find((p) => p.slug === params.slug);
	if (!platform) throw error(404, 'Platform not found');

	const libraryResult = await getLibraryItems(
		{ type: 'game', sortBy, limit: 500, platformId: platform.id },
		userId
	);

	// Compute stats
	const items = libraryResult.items;
	const genreMap = new Map<string, number>();
	let ratingSum = 0;
	let ratingCount = 0;
	for (const item of items) {
		if (item.rating) { ratingSum += item.rating; ratingCount++; }
		for (const g of item.genres ?? []) {
			genreMap.set(g, (genreMap.get(g) ?? 0) + 1);
		}
	}

	const topGenres = [...genreMap.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([name, count]) => ({ name, count }));

	return {
		platform,
		items,
		total: libraryResult.total,
		sortBy,
		stats: {
			totalGames: items.length,
			avgRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
			topGenres
		}
	};
};
