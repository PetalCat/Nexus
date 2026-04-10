import type { ServiceAdapter } from './base';
import type { ServiceConfig, ServiceHealth, UnifiedMedia, UnifiedSearchResult, UserCredential } from './types';

// ---------------------------------------------------------------------------
// StreamyStats adapter
//
// StreamyStats is a Jellyfin analytics/recommendation service. It authenticates
// via the user's Jellyfin token and identifies the Jellyfin server by URL.
//
// Config convention (mirrors Overseerr pattern):
//   url      → StreamyStats instance URL (e.g. http://localhost:3000)
//   username → Jellyfin server URL (for server identification + image URLs)
//   apiKey   → not used (StreamyStats has no master key; auth is Jellyfin tokens only)
// ---------------------------------------------------------------------------

function jellyfinUrl(config: ServiceConfig): string {
	// Stored in the username field; strip trailing slash
	return (config.username ?? '').replace(/\/+$/, '');
}

function authHeader(userCred?: UserCredential): Record<string, string> {
	if (!userCred?.accessToken) return {};
	return { Authorization: `MediaBrowser Token="${userCred.accessToken}"` };
}

async function ssFetch(
	config: ServiceConfig,
	path: string,
	params?: Record<string, string>,
	userCred?: UserCredential,
	timeoutMs = 8000
) {
	const url = new URL(`${config.url.replace(/\/+$/, '')}${path}`);
	if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url.toString(), {
		headers: {
			...authHeader(userCred),
			Accept: 'application/json'
		},
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`StreamyStats ${path} → ${res.status}`);
	return res.json();
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

interface SSItem {
	id: string;
	name: string;
	type: string;
	overview?: string;
	productionYear?: number;
	communityRating?: number;
	genres?: string[];
	primaryImageTag?: string;
	backdropImageTags?: string[];
	reason?: string;
	similarity?: number;
}

function normalizeItem(item: SSItem, config: ServiceConfig): UnifiedMedia {
	const jfUrl = jellyfinUrl(config);
	const poster = item.primaryImageTag
		? `${jfUrl}/Items/${item.id}/Images/Primary?tag=${item.primaryImageTag}`
		: undefined;
	const backdrop =
		item.backdropImageTags && item.backdropImageTags.length > 0
			? `${jfUrl}/Items/${item.id}/Images/Backdrop?tag=${item.backdropImageTags[0]}`
			: undefined;

	return {
		id: `${item.id}:${config.id}`,
		sourceId: item.id,
		serviceId: config.id,
		serviceType: 'streamystats',
		type: item.type === 'Movie' ? 'movie' : 'show',
		title: item.name,
		description: item.overview,
		poster,
		backdrop,
		year: item.productionYear,
		rating: item.communityRating,
		genres: item.genres,
		metadata: {
			...(item.reason ? { reason: item.reason } : {}),
			...(item.similarity != null ? { similarity: item.similarity } : {})
		},
		actionUrl: jfUrl ? `${jfUrl}/web/index.html#!/details?id=${item.id}` : undefined
	};
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Exported helpers for direct use by services layer
// ---------------------------------------------------------------------------

interface SSRecommendationEntry {
	item: SSItem;
	reason?: string;
	similarity?: number;
	basedOn?: Array<{ name: string }>;
}

/**
 * Fetch personalized recommendations from StreamyStats.
 * type: 'Movie' | 'Series' | 'all'
 * userCred must carry a Jellyfin user access token (SS authenticates via Jellyfin).
 */
export async function getStreamyStatsRecommendations(
	config: ServiceConfig,
	type: 'Movie' | 'Series' | 'all',
	userCred: UserCredential,
	limit = 20
): Promise<UnifiedMedia[]> {
	if (!userCred.accessToken) return [];
	const jfUrl = jellyfinUrl(config);
	const data = await ssFetch(
		config,
		'/api/recommendations',
		{ serverUrl: jfUrl, type, limit: String(limit), includeReasons: 'true' },
		userCred
	);
	// Response: { data: [{ item, reason, similarity, basedOn }] }
	// Fall back to flat array for older versions
	const entries: SSRecommendationEntry[] = Array.isArray(data?.data)
		? data.data
		: Array.isArray(data)
			? (data as SSItem[]).map((i) => ({ item: i }))
			: [];
	return entries.map(({ item, reason, similarity }) =>
		normalizeItem({ ...item, reason, similarity }, config)
	);
}

export const streamystatsAdapter: ServiceAdapter = {
	id: 'streamystats',
	displayName: 'StreamyStats',
	defaultPort: 3000,
	color: '#b088f9',
	abbreviation: 'SS',
	authVia: 'jellyfin',
	derivedFrom: ['jellyfin'],
	parentRequired: true,
	mediaTypes: ['movie', 'show'],
	// StreamyStats has no per-user accounts — it authenticates via the user's Jellyfin token.
	// resolveUserCred in services.ts handles this special case automatically.
	onboarding: {
		category: 'analytics',
		description: 'Track viewing activity and statistics',
		priority: 1,
		requiredFields: ['url'],
	},

	async ping(config: ServiceConfig): Promise<ServiceHealth> {
		const start = Date.now();
		try {
			// StreamyStats has no master API key — just check reachability.
			// Try /api/health first; fall back to root if it 404s.
			const base = config.url.replace(/\/+$/, '');
			let res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
			if (res.status === 404) {
				res = await fetch(base, { signal: AbortSignal.timeout(5000) });
			}
			const online = res.ok || res.status === 401 || res.status === 403;
			return {
				serviceId: config.id,
				name: config.name,
				type: 'streamystats',
				online,
				latency: Date.now() - start,
				error: online ? undefined : `HTTP ${res.status}`
			};
		} catch (e) {
			return {
				serviceId: config.id,
				name: config.name,
				type: 'streamystats',
				online: false,
				latency: Date.now() - start,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	},

	async getTrending(config: ServiceConfig, userCred?: UserCredential): Promise<UnifiedMedia[]> {
		if (!userCred?.accessToken) return [];
		try {
			return await getStreamyStatsRecommendations(config, 'all', userCred, 20);
		} catch (e) {
			console.error('[StreamyStats] getTrending error:', e instanceof Error ? e.message : e);
			return [];
		}
	},

	async search(
		config: ServiceConfig,
		query: string,
		userCred?: UserCredential
	): Promise<UnifiedSearchResult> {
		if (!userCred?.accessToken) return { items: [], total: 0, source: config.name };
		try {
			const jfUrl = jellyfinUrl(config);
			const data = await ssFetch(
				config,
				'/api/search',
				{ q: query, serverUrl: jfUrl, limit: '20' },
				userCred
			);
			const items: SSItem[] = Array.isArray(data) ? data : (data.items ?? data.Items ?? []);
			return {
				items: items.map((item) => normalizeItem(item, config)),
				total: items.length,
				source: config.name
			};
		} catch (e) {
			console.error('[StreamyStats] search error:', e instanceof Error ? e.message : e);
			return { items: [], total: 0, source: config.name };
		}
	}
};
