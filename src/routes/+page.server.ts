import { registryV2 } from '$lib/adapters/v2';
import type { UnifiedMedia } from '$lib/adapters/types';
import { resolveServiceConfig } from '$lib/server/v2-services';
import type { PageServerLoad } from './$types';

type HomeRow = {
	id: string;
	title: string;
	items: UnifiedMedia[];
};

const BACKENDS = ['jellyfin', 'invidious'] as const;

function hasBackdrop(item: UnifiedMedia): boolean {
	return Boolean(item.backdrop ?? (item as UnifiedMedia & { backdropUrl?: string }).backdropUrl);
}

export const load: PageServerLoad = async () => {
	const rows: HomeRow[] = [];

	for (const backend of BACKENDS) {
		const config = resolveServiceConfig(backend);
		if (!config) continue;

		const adapter = registryV2.get(backend);
		if (!adapter) continue;

		try {
			if (adapter.getRecentlyAdded) {
				const items = await adapter.getRecentlyAdded(config);
				rows.push({
					id: `${backend}-recently-added`,
					title: `${config.name} Recently Added`,
					items
				});
			}

			if (adapter.getLibrary) {
				const page = await adapter.getLibrary(config, { limit: 20 });
				rows.push({
					id: `${backend}-browse`,
					title: `Browse ${config.name}`,
					items: page.items
				});
			}
		} catch (error) {
			console.warn(`[home] Skipping ${backend}:`, error);
		}
	}

	const hero = rows.flatMap((row) => row.items).find(hasBackdrop) ?? null;

	return {
		rows,
		hero,
		hasContent: rows.some((row) => row.items.length > 0)
	};
};
