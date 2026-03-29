import { registry } from '../adapters/registry';
import type { UnifiedMedia } from '../adapters/types';
import { getEnabledConfigs, resolveUserCred } from './services';
import { withCache } from './cache';

export interface FranchiseData {
	name: string;
	movies: UnifiedMedia[];
	shows: UnifiedMedia[];
	books: UnifiedMedia[];
	games: UnifiedMedia[];
	music: UnifiedMedia[];
	videos: UnifiedMedia[];
}

const MEDIA_TYPE_BUCKETS: Record<string, keyof Omit<FranchiseData, 'name'>> = {
	movie: 'movies',
	show: 'shows',
	episode: 'shows',
	book: 'books',
	game: 'games',
	music: 'music',
	album: 'music',
	video: 'videos'
};

/**
 * Build a franchise page by searching across all services for related content.
 * Uses a franchise name (e.g. "Star Wars", "Dune", "Batman") to find matches.
 */
export async function getFranchiseData(name: string, userId: string): Promise<FranchiseData> {
	return withCache(`franchise:${name.toLowerCase()}:${userId}`, 1_800_000, async () => {
		const results: FranchiseData = {
			name,
			movies: [],
			shows: [],
			books: [],
			games: [],
			music: [],
			videos: []
		};

		const configs = getEnabledConfigs();

		await Promise.allSettled(
			configs.map(async (config) => {
				const adapter = registry.get(config.type);
				if (!adapter?.search) return;

				const cred = resolveUserCred(config, userId);
				try {
					const searchResult = await adapter.search(config, name, cred);
					for (const item of searchResult.items) {
						const bucket = MEDIA_TYPE_BUCKETS[item.type];
						if (bucket) results[bucket].push(item);
					}
				} catch {
					/* silent — best-effort across all services */
				}
			})
		);

		// Deduplicate within each category
		results.movies = dedup(results.movies);
		results.shows = dedup(results.shows);
		results.books = dedup(results.books);
		results.games = dedup(results.games);
		results.music = dedup(results.music);
		results.videos = dedup(results.videos);

		return results;
	});
}

function dedup(items: UnifiedMedia[]): UnifiedMedia[] {
	const seen = new Map<string, UnifiedMedia>();
	for (const item of items) {
		const key = item.sourceId + ':' + item.serviceId;
		if (!seen.has(key)) seen.set(key, item);
	}
	return Array.from(seen.values());
}
