import { getLibraryItems, getConfigsForMediaType } from '$lib/server/services';
import { getPlatforms, getCollections } from '$lib/adapters/romm';
import { getUserCredentialForService } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const sortBy = url.searchParams.get('sort') || 'title';
	const platformParam = url.searchParams.get('platform');
	const platformId = platformParam ? Number(platformParam) : undefined;
	const userId = locals.user?.id;

	const rommConfigs = getConfigsForMediaType('game');
	const hasGameService = rommConfigs.length > 0;

	// Resolve user credentials for each RomM instance
	const rommCreds = rommConfigs.map((c) =>
		userId ? getUserCredentialForService(userId, c.id) ?? undefined : undefined
	);

	const [libraryResult, ...platformResults] = await Promise.all([
		getLibraryItems({ type: 'game', sortBy, limit: 200, platformId }, userId),
		...rommConfigs.map((c, i) => getPlatforms(c, rommCreds[i]))
	]);

	const platforms = platformResults.flat();

	let collections: { id: number; name: string; description?: string; romIds: number[] }[] = [];
	try {
		const allCollections = await Promise.all(
			rommConfigs.map((c, i) => getCollections(c, rommCreds[i]))
		);
		collections = allCollections.flat().map((c) => ({
			id: c.id,
			name: c.name,
			description: c.description,
			romIds: c.roms ?? []
		}));
	} catch { /* ignore */ }

	return {
		items: libraryResult.items,
		total: libraryResult.total,
		sortBy,
		hasGameService,
		platforms,
		selectedPlatform: platformId ?? null,
		collections
	};
};
