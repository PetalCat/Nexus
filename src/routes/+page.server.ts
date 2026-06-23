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
	// Nexus is one unified surface over everything you host — so the home merges
	// each backend's content into backend-agnostic rows. We never name the
	// underlying service in the UI (no "Jellyfin Recently Added"); a viewer just
	// sees "Recently Added" / "Your Library".
	const recentlyAdded: UnifiedMedia[] = [];
	const library: UnifiedMedia[] = [];

	for (const backend of BACKENDS) {
		const config = resolveServiceConfig(backend);
		if (!config) continue;

		const adapter = registryV2.get(backend);
		if (!adapter) continue;

		try {
			if (adapter.getRecentlyAdded) {
				recentlyAdded.push(...(await adapter.getRecentlyAdded(config)));
			}
			if (adapter.getLibrary) {
				const page = await adapter.getLibrary(config, { limit: 20 });
				library.push(...page.items);
			}
		} catch (error) {
			console.warn(`[home] Skipping ${backend}:`, error);
		}
	}

	const rows: HomeRow[] = [];
	if (recentlyAdded.length) rows.push({ id: 'recently-added', title: 'Recently Added', items: recentlyAdded });
	if (library.length) rows.push({ id: 'library', title: 'Your Library', items: library });

	const hero = rows.flatMap((row) => row.items).find(hasBackdrop) ?? null;

	return {
		rows,
		hero,
		hasContent: rows.some((row) => row.items.length > 0)
	};
};
