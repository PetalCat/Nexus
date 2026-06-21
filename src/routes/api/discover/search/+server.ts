import { json } from '@sveltejs/kit';
import { getEnabledConfigs } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import { radarrLookupMovie } from '$lib/adapters/radarr';
import { sonarrLookupSeries } from '$lib/adapters/sonarr';
import type { RequestHandler } from './$types';

// GET /api/discover/search?q=<query>&type=movie|tv
//
// Native discovery search for the no-Overseerr path. Uses the enabled
// Radarr / Sonarr service's own TMDB/SkyHook lookup (no separate TMDB key) and
// returns normalized results the request UI can render + submit.
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const q = (url.searchParams.get('q') ?? '').trim();
	const type = (url.searchParams.get('type') ?? 'movie') as 'movie' | 'tv';
	if (!q) return json({ results: [] });
	if (type !== 'movie' && type !== 'tv') {
		return json({ error: 'type must be movie or tv' }, { status: 400 });
	}

	const arrType = type === 'movie' ? 'radarr' : 'sonarr';
	const config = getEnabledConfigs().find((c) => c.type === arrType);
	if (!config) return json({ results: [], error: `No enabled ${arrType} service` });

	const cacheKey = `discover-search:${type}:${q.toLowerCase()}`;
	const results = await withCache(cacheKey, 300_000, async () => {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const raw: any[] =
				type === 'movie'
					? await radarrLookupMovie(config, q)
					: await sonarrLookupSeries(config, q);

			return raw.slice(0, 20).map((item) => {
				const poster = item.images?.find((i: { coverType: string }) => i.coverType === 'poster')?.remoteUrl;
				return {
					tmdbId: item.tmdbId ?? null,
					tvdbId: item.tvdbId ?? null,
					type,
					title: item.title ?? 'Unknown',
					year: item.year ?? undefined,
					poster: poster ?? undefined,
					overview: item.overview ?? undefined
				};
			}).filter((r) => r.tmdbId != null);
		} catch {
			return [];
		}
	});

	return json({ results });
};
