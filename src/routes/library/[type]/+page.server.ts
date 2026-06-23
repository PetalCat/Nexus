import { error } from '@sveltejs/kit';
import { registryV2 } from '$lib/adapters/v2';
import type { UnifiedMedia } from '$lib/adapters/types';
import { resolveServiceConfig } from '$lib/server/v2-services';
import type { PageServerLoad } from './$types';

// Per-type library pages. Each route maps to a backend + a MediaType filter for the
// LibraryQuery. Books/Games have no backend wired in phase-0 yet, so they render an
// honest empty state rather than fabricated content.
const TYPE_MAP: Record<
	string,
	{ backend: string; media: string; accept: string[]; title: string }
> = {
	movies: { backend: 'jellyfin', media: 'movie', accept: ['movie'], title: 'Movies' },
	shows: { backend: 'jellyfin', media: 'show', accept: ['show', 'series'], title: 'Shows' },
	music: { backend: 'jellyfin', media: 'music', accept: ['music', 'album'], title: 'Music' },
	videos: { backend: 'invidious', media: 'video', accept: ['video'], title: 'Videos' },
	books: { backend: '', media: 'book', accept: ['book'], title: 'Books' },
	games: { backend: '', media: 'game', accept: ['game'], title: 'Games' }
};

const hasBackdrop = (item: UnifiedMedia): boolean => Boolean(item.backdrop);

export const load: PageServerLoad = async ({ params }) => {
	const map = TYPE_MAP[params.type];
	if (!map) throw error(404, 'Unknown library');

	let catalog: UnifiedMedia[] = [];
	let recentlyFiled: UnifiedMedia[] = [];
	let hasBackend = false;

	if (map.backend) {
		const config = resolveServiceConfig(map.backend);
		const adapter = registryV2.get(map.backend);
		if (config && adapter) {
			hasBackend = true;
			try {
				if (adapter.getLibrary) {
					const page = await adapter.getLibrary(config, { type: map.media, limit: 120 });
					catalog = page.items;
				}
				if (adapter.getRecentlyAdded) {
					const recent = await adapter.getRecentlyAdded(config);
					recentlyFiled = recent.filter((i) => map.accept.includes(i.type)).slice(0, 12);
				}
			} catch (err) {
				console.warn(`[library/${params.type}] skipping ${map.backend}:`, err);
			}
		}
	}

	const hero = recentlyFiled.find(hasBackdrop) ?? catalog.find(hasBackdrop) ?? catalog[0] ?? null;

	return {
		type: params.type,
		title: map.title,
		catalog,
		recentlyFiled,
		hero,
		count: catalog.length,
		hasBackend
	};
};
