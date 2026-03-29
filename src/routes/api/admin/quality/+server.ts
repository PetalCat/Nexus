import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnabledConfigs } from '$lib/server/services';
import { withCache } from '$lib/server/cache';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user?.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const stats = await withCache('admin-quality-stats', 300_000, async () => {
		const configs = getEnabledConfigs();
		const breakdown: Record<string, number> = {};
		const byService: Record<string, { total: number; withFile: number; qualities: Record<string, number> }> = {};
		let total = 0;
		let withFile = 0;

		for (const config of configs) {
			// Only check *arr services that manage files
			if (!['radarr', 'sonarr', 'lidarr'].includes(config.type)) continue;

			try {
				const apiVersion = config.type === 'lidarr' ? 'v1' : 'v3';
				const endpoint = config.type === 'radarr' ? 'movie' : config.type === 'sonarr' ? 'series' : 'album';
				const url = new URL(`${config.url}/api/${apiVersion}/${endpoint}`);
				url.searchParams.set('apikey', config.apiKey ?? '');

				const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
				if (!res.ok) continue;
				const items = await res.json();

				const svcStats = { total: 0, withFile: 0, qualities: {} as Record<string, number> };

				for (const item of items) {
					svcStats.total++;
					total++;

					const hasFile =
						config.type === 'radarr'
							? item.hasFile
							: config.type === 'sonarr'
								? (item.statistics?.episodeFileCount ?? 0) > 0
								: (item.statistics?.trackFileCount ?? 0) > 0;

					if (hasFile) {
						svcStats.withFile++;
						withFile++;

						let quality = 'Unknown';
						if (config.type === 'radarr' && item.movieFile?.quality?.quality?.name) {
							quality = item.movieFile.quality.quality.name;
						} else if (config.type === 'sonarr') {
							quality = item.qualityProfileId ? `Profile ${item.qualityProfileId}` : 'Unknown';
						} else if (config.type === 'lidarr') {
							quality = item.qualityProfileId ? `Profile ${item.qualityProfileId}` : 'Unknown';
						}

						breakdown[quality] = (breakdown[quality] ?? 0) + 1;
						svcStats.qualities[quality] = (svcStats.qualities[quality] ?? 0) + 1;
					}
				}

				byService[config.name] = svcStats;
			} catch {
				continue;
			}
		}

		// Group by resolution tier for the summary
		const tiers: Record<string, number> = { '4K': 0, '1080p': 0, '720p': 0, SD: 0, Other: 0 };
		for (const [quality, count] of Object.entries(breakdown)) {
			const q = quality.toLowerCase();
			if (q.includes('2160') || q.includes('4k') || q.includes('uhd')) tiers['4K'] += count;
			else if (q.includes('1080')) tiers['1080p'] += count;
			else if (q.includes('720')) tiers['720p'] += count;
			else if (q.includes('480') || q.includes('576') || q.includes('sd')) tiers['SD'] += count;
			else tiers['Other'] += count;
		}

		return { total, withFile, missing: total - withFile, tiers, breakdown, byService };
	});

	return json(stats);
};
