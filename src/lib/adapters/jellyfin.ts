import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mediaType(jfType: string): UnifiedMedia['type'] {
	switch (jfType) {
		case 'Movie':
			return 'movie';
		case 'Series':
			return 'show';
		case 'Episode':
			return 'episode';
		case 'MusicAlbum':
			return 'album';
		case 'Audio':
			return 'music';
		case 'LiveTvChannel':
			return 'live';
		default:
			return 'movie';
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(config: ServiceConfig, item: any): UnifiedMedia {
	const type = mediaType(item.Type);
	const posterId = item.ImageTags?.Primary ? item.Id : (item.ParentPrimaryImageItemId ?? null);
	return {
		id: `${item.Id}:${config.id}`,
		sourceId: item.Id,
		serviceId: config.id,
		serviceType: 'jellyfin',
		type,
		title: item.Name || item.SeriesName || 'Unknown',
		sortTitle: item.SortName,
		description: item.Overview,
		poster: posterId ? `${config.url}/Items/${posterId}/Images/Primary?quality=90` : undefined,
		backdrop: item.BackdropImageTags?.[0]
			? `${config.url}/Items/${item.Id}/Images/Backdrop?quality=90`
			: undefined,
		year: item.ProductionYear,
		rating: item.CommunityRating,
		genres: item.Genres ?? [],
		studios: item.Studios?.map((s: { Name: string }) => s.Name) ?? [],
		duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000_000) : undefined,
		status: 'available',
		progress:
			item.UserData?.PlayedPercentage != null ? item.UserData.PlayedPercentage / 100 : undefined,
		metadata: { jellyfinId: item.Id, userData: item.UserData },
		actionLabel: type === 'music' || type === 'album' ? 'Listen' : 'Watch',
		actionUrl: `${config.url}/web/index.html#!/details?id=${item.Id}`
	};
}

async function jfFetch(config: ServiceConfig, path: string, params?: Record<string, string>) {
	const url = new URL(`${config.url}${path}`);
	if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url.toString(), {
		headers: { 'X-Emby-Token': config.apiKey ?? '' }
	});
	if (!res.ok) throw new Error(`Jellyfin ${path} → ${res.status}`);
	return res.json();
}

const FIELDS = 'Overview,Genres,Studios,BackdropImageTags,ImageTags,UserData';

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const jellyfinAdapter: ServiceAdapter = {
	id: 'jellyfin',
	displayName: 'Jellyfin',
	defaultPort: 8096,
	icon: 'jellyfin',
	mediaTypes: ['movie', 'show', 'music', 'live'],

	async ping(config): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			await jfFetch(config, '/System/Info/Public');
			return {
				serviceId: config.id,
				name: config.name,
				type: 'jellyfin',
				online: true,
				latency: Date.now() - start
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'jellyfin',
				online: false,
				error: String(e)
			};
		}
	},

	async getContinueWatching(config): Promise<UnifiedMedia[]> {
		try {
			const data = await jfFetch(config, '/Items/Resume', {
				Limit: '20',
				Fields: FIELDS,
				MediaTypes: 'Video'
			});
			return (data.Items ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	async getRecentlyAdded(config): Promise<UnifiedMedia[]> {
		try {
			const data = await jfFetch(config, '/Items/Latest', {
				Limit: '20',
				Fields: FIELDS,
				IncludeItemTypes: 'Movie,Series'
			});
			return (data ?? []).map((i: unknown) => normalize(config, i));
		} catch {
			return [];
		}
	},

	async search(config, query): Promise<UnifiedSearchResult> {
		try {
			const data = await jfFetch(config, '/Items', {
				searchTerm: query,
				IncludeItemTypes: 'Movie,Series,MusicAlbum,Audio',
				Recursive: 'true',
				Limit: '20',
				Fields: FIELDS
			});
			return {
				items: (data.Items ?? []).map((i: unknown) => normalize(config, i)),
				total: data.TotalRecordCount ?? 0,
				source: 'jellyfin'
			};
		} catch {
			return { items: [], total: 0, source: 'jellyfin' };
		}
	},

	async getItem(config, sourceId): Promise<UnifiedMedia | null> {
		try {
			const item = await jfFetch(config, `/Items/${sourceId}`, {
				Fields: `${FIELDS},People,MediaStreams`
			});
			return normalize(config, item);
		} catch {
			return null;
		}
	}
};
