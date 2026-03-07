import { json } from '@sveltejs/kit';
import { getEnabledConfigs } from '$lib/server/services';
import { withCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

// GET /api/requests/seasons?serviceId=X&tmdbId=Y
// Returns season list for a TV show from Overseerr's TMDB data
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const serviceId = url.searchParams.get('serviceId');
	const tmdbId = url.searchParams.get('tmdbId');
	if (!serviceId || !tmdbId) {
		return json({ error: 'Missing serviceId or tmdbId' }, { status: 400 });
	}

	const config = getEnabledConfigs().find((c) => c.id === serviceId && c.type === 'overseerr');
	if (!config) return json({ error: 'Service not found' }, { status: 404 });

	const cacheKey = `seasons:${serviceId}:${tmdbId}`;
	const seasons = await withCache(cacheKey, 300_000, async () => {
		const res = await fetch(`${config.url}/api/v1/tv/${tmdbId}`, {
			headers: { 'X-Api-Key': config.apiKey ?? '', 'Content-Type': 'application/json' },
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) throw new Error(`Overseerr /tv/${tmdbId} -> ${res.status}`);
		const data = await res.json();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (data.seasons ?? []).map((s: any) => ({
			seasonNumber: s.seasonNumber as number,
			name: (s.name as string) || `Season ${s.seasonNumber}`,
			episodeCount: (s.episodeCount as number) ?? 0,
			status: mapSeasonStatus(s, data.mediaInfo),
		}));
	});

	return json({ seasons });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSeasonStatus(season: any, mediaInfo: any): 'available' | 'requested' | 'none' {
	if (!mediaInfo) return 'none';
	// Check if season is fully available
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const seasonStatus = mediaInfo.seasons?.find((ms: any) => ms.seasonNumber === season.seasonNumber);
	if (seasonStatus?.status === 5) return 'available';
	if (seasonStatus?.status === 2 || seasonStatus?.status === 3 || seasonStatus?.status === 4) return 'requested';
	// Check active requests for this season
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const hasRequest = mediaInfo.requests?.some((r: any) =>
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		r.seasons?.some((rs: any) => rs.seasonNumber === season.seasonNumber)
	);
	if (hasRequest) return 'requested';
	return 'none';
}
