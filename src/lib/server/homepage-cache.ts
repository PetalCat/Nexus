import { getRawDb } from '$lib/db';
import { withCache, withStaleCache, invalidate } from './cache';
import type { ScoredRecommendation, ReasonType } from './recommendations/types';
import type { UnifiedMedia } from '$lib/adapters/types';

// Re-export shared types so existing server imports still work
export type { HeroItem, HomepageItem, HomepageRow, HomepageCache } from '$lib/types/homepage';
import type { HeroItem, HomepageItem, HomepageRow, HomepageCache } from '$lib/types/homepage';

// ---------------------------------------------------------------------------
// Homepage Cache
//
// Assembles pre-computed recommendations into homepage-ready rows.
// Called by the rec scheduler after recommendations are rebuilt.
// ---------------------------------------------------------------------------

const MIN_ROW_ITEMS = 3;

function optimizeHomepageImage(
	url: string | undefined,
	kind: 'poster' | 'hero-backdrop' | 'thumb-backdrop'
): string | undefined {
	if (!url) return undefined;

	try {
		const parsed = new URL(url);
		const isJellyfinImage = parsed.pathname.includes('/Items/') && parsed.pathname.includes('/Images/');
		if (!isJellyfinImage) return url;

		if (kind === 'poster') {
			parsed.searchParams.set('quality', '78');
			parsed.searchParams.set('maxWidth', '360');
		} else if (kind === 'hero-backdrop') {
			parsed.searchParams.set('quality', '72');
			parsed.searchParams.set('maxWidth', '960');
		} else {
			parsed.searchParams.set('quality', '74');
			parsed.searchParams.set('maxWidth', '640');
		}

		return parsed.toString();
	} catch {
		return url;
	}
}

function proxyHomepageImage(url: string | undefined, serviceId: string): string | undefined {
	if (!url) return undefined;

	try {
		const parsed = new URL(url);
		const path = `${parsed.pathname}${parsed.search}`;
		return `/api/media/image?service=${encodeURIComponent(serviceId)}&path=${encodeURIComponent(path)}`;
	} catch {
		return url;
	}
}

function homepageImage(url: string | undefined, serviceId: string, kind: 'poster' | 'hero-backdrop' | 'thumb-backdrop'): string | undefined {
	return proxyHomepageImage(optimizeHomepageImage(url, kind), serviceId);
}

/** Format seconds into "Xh Ym" */
function formatDuration(secs?: number): string | undefined {
	if (!secs) return undefined;
	const h = Math.floor(secs / 3600);
	const m = Math.floor((secs % 3600) / 60);
	return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Convert a ScoredRecommendation to a HomepageItem */
function recToItem(rec: ScoredRecommendation, context?: string): HomepageItem {
	const item = rec.item;
	return {
		id: item.id,
		sourceId: item.sourceId,
		serviceId: item.serviceId,
		serviceType: item.serviceType,
		title: item.title,
		poster: homepageImage(item.poster, item.serviceId, 'poster'),
		backdrop: homepageImage(item.backdrop, item.serviceId, 'thumb-backdrop'),
		year: item.year,
		mediaType: item.type,
		genres: item.genres,
		rating: item.rating,
		context,
		streamUrl: item.streamUrl,
		description: item.description
	};
}

/** Convert a ScoredRecommendation to a HeroItem */
function recToHero(rec: ScoredRecommendation): HeroItem {
	const item = rec.item;
	return {
		id: item.id,
		sourceId: item.sourceId,
		serviceId: item.serviceId,
		serviceType: item.serviceType,
		title: item.title,
		year: item.year,
		runtime: formatDuration(item.duration),
		rating: item.rating,
		overview: item.description,
		backdrop: homepageImage(item.backdrop, item.serviceId, 'hero-backdrop'),
		poster: homepageImage(item.poster, item.serviceId, 'poster'),
		mediaType: item.type,
		genres: item.genres,
		reason: rec.reason,
		provider: rec.provider,
		streamUrl: item.streamUrl,
		trailerUrl: (item.metadata?.trailerUrl as string) ?? undefined
	};
}

/** Convert a UnifiedMedia (continue watching) to a HomepageItem */
export function cwToItem(item: UnifiedMedia): HomepageItem {
	const progress = item.progress ?? 0;
	const remaining = item.duration ? item.duration * (1 - progress) : 0;
	const h = Math.floor(remaining / 3600);
	const m = Math.floor((remaining % 3600) / 60);
	const timeRemaining = remaining > 0
		? (h > 0 ? `${h}h ${m}m left` : `${m}m left`)
		: undefined;

	// Extract episode info from metadata or title pattern
	const season = item.metadata?.parentIndexNumber ?? item.metadata?.season;
	const episode = item.metadata?.indexNumber ?? item.metadata?.episode;
	const episodeInfo = season != null && episode != null
		? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
		: undefined;

	return {
		id: item.id,
		sourceId: item.sourceId,
		serviceId: item.serviceId,
		serviceType: item.serviceType,
		title: item.title,
		poster: homepageImage(item.poster, item.serviceId, 'poster'),
		backdrop: homepageImage(item.thumb ?? item.backdrop, item.serviceId, 'thumb-backdrop'),
		year: item.year,
		mediaType: item.type,
		genres: item.genres,
		rating: item.rating,
		progress,
		timeRemaining,
		episodeInfo,
		streamUrl: item.streamUrl,
		description: item.description
	};
}

export { optimizeHomepageImage };
export { homepageImage };

// Reason types that map to specific named rows
const TRENDING_REASONS: ReasonType[] = ['trending'];
const FRIEND_REASONS: ReasonType[] = ['friend_shared', 'friend_watched'];
const TIME_REASONS: ReasonType[] = ['time_pattern'];
const GENRE_REASONS: ReasonType[] = ['genre_match'];
// Everything else goes to "Recommended for You"
const CATCH_ALL_REASONS: ReasonType[] = [
	'similar_users', 'similar_item', 'studio_match',
	'era_match', 'completion_pattern', 'external'
];

/**
 * Build homepage cache from pre-computed recommendations.
 * Reads from recommendation_cache table (already populated by rec scheduler).
 */
export function buildHomepageCache(userId: string): HomepageCache | null {
	const raw = getRawDb();

	// Read all cached recommendations for this user
	const rows = raw.prepare(
		`SELECT results FROM recommendation_cache WHERE user_id = ?`
	).all(userId) as Array<{ results: string }>;

	if (rows.length === 0) return null;

	const allRecs: ScoredRecommendation[] = [];
	for (const row of rows) {
		try {
			const parsed = JSON.parse(row.results) as ScoredRecommendation[];
			allRecs.push(...parsed);
		} catch { /* skip malformed */ }
	}

	if (allRecs.length === 0) return null;

	// Deduplicate by sourceId (keep highest score)
	const seen = new Map<string, ScoredRecommendation>();
	for (const rec of allRecs.sort((a, b) => b.score - a.score)) {
		const key = rec.item.sourceId;
		if (!seen.has(key)) seen.set(key, rec);
	}
	const deduped = Array.from(seen.values());

	// Hero: top 8 with backdrops
	const heroRecs = deduped
		.filter((r) => r.item.backdrop)
		.slice(0, 8);
	const hero = heroRecs.map(recToHero);

	// Exclude hero items from rows
	const heroIds = new Set(heroRecs.map((r) => r.item.sourceId));
	const remaining = deduped.filter((r) => !heroIds.has(r.item.sourceId));

	// Group by reason type
	const trending = remaining.filter((r) => TRENDING_REASONS.includes(r.reasonType));
	const friends = remaining.filter((r) => FRIEND_REASONS.includes(r.reasonType));
	const timeAware = remaining.filter((r) => TIME_REASONS.includes(r.reasonType));
	const genreMatch = remaining.filter((r) => GENRE_REASONS.includes(r.reasonType));
	const catchAll = remaining.filter((r) => CATCH_ALL_REASONS.includes(r.reasonType));

	const resultRows: HomepageRow[] = [];

	// Trending — split by media type for cleaner rows
	const trendingByType = new Map<string, ScoredRecommendation[]>();
	for (const r of trending) {
		const t = r.item.type;
		if (!trendingByType.has(t)) trendingByType.set(t, []);
		trendingByType.get(t)!.push(r);
	}

	const trendingLabels: Record<string, { title: string; subtitle: string }> = {
		movie: { title: 'Trending Movies', subtitle: 'Popular films this week' },
		show: { title: 'Trending Shows', subtitle: 'Popular series this week' },
		video: { title: 'Trending Videos', subtitle: 'Popular videos this week' },
		book: { title: 'Trending Books', subtitle: 'Popular reads this week' },
		game: { title: 'Trending Games', subtitle: 'Popular games this week' }
	};

	for (const [mediaType, recs] of trendingByType) {
		if (recs.length < MIN_ROW_ITEMS) continue;
		const label = trendingLabels[mediaType] ?? { title: `Trending ${mediaType}`, subtitle: `Popular ${mediaType} this week` };
		resultRows.push({
			id: `trending-${mediaType}`,
			title: label.title,
			subtitle: label.subtitle,
			type: 'reason',
			items: recs.slice(0, 20).map((r) => recToItem(r))
		});
	}

	// Single combined trending row as fallback if no type has enough items
	if (resultRows.length === 0 && trending.length >= MIN_ROW_ITEMS) {
		resultRows.push({
			id: 'trending',
			title: 'Trending Now',
			subtitle: 'Popular across Nexus right now',
			type: 'reason',
			items: trending.slice(0, 20).map((r) => recToItem(r))
		});
	}

	// From Friends
	if (friends.length >= MIN_ROW_ITEMS) {
		resultRows.push({
			id: 'friends',
			title: 'From Friends',
			subtitle: 'Shared & watched by people you follow',
			type: 'reason',
			items: friends.slice(0, 20).map((r) => {
				const context = r.reasonType === 'friend_shared'
					? `Shared by ${r.basedOn?.[0] ?? 'a friend'}`
					: `${r.basedOn?.[0] ?? 'A friend'} watched this`;
				return recToItem(r, context);
			})
		});
	}

	// Right Now (time-aware)
	if (timeAware.length >= MIN_ROW_ITEMS) {
		resultRows.push({
			id: 'time-aware',
			title: 'Perfect for Right Now',
			subtitle: 'Based on what you usually watch at this time',
			type: 'reason',
			items: timeAware.slice(0, 20).map((r) => recToItem(r))
		});
	}

	// Recommended for You — split by type for variety
	const recByType = new Map<string, ScoredRecommendation[]>();
	for (const r of catchAll) {
		const t = r.item.type;
		if (!recByType.has(t)) recByType.set(t, []);
		recByType.get(t)!.push(r);
	}

	const recLabels: Record<string, string> = {
		movie: 'Recommended Movies',
		show: 'Recommended Shows',
		video: 'Recommended Videos',
		book: 'Recommended Books',
		game: 'Recommended Games'
	};

	for (const [mediaType, recs] of recByType) {
		if (recs.length < MIN_ROW_ITEMS) continue;
		resultRows.push({
			id: `recommended-${mediaType}`,
			title: recLabels[mediaType] ?? 'Recommended for You',
			type: 'reason',
			items: recs.slice(0, 20).map((r) => recToItem(r))
		});
	}

	// Fallback combined row
	if (!recByType.size && catchAll.length >= MIN_ROW_ITEMS) {
		resultRows.push({
			id: 'recommended',
			title: 'Recommended for You',
			type: 'reason',
			items: catchAll.slice(0, 20).map((r) => recToItem(r))
		});
	}

	// Genre rows — group by genre, ordered by user affinity
	if (genreMatch.length > 0) {
		const byGenre = new Map<string, ScoredRecommendation[]>();
		for (const r of genreMatch) {
			const genre = r.basedOn?.[0] ?? 'your favorites';
			if (!byGenre.has(genre)) byGenre.set(genre, []);
			byGenre.get(genre)!.push(r);
		}

		// Load genre affinity to order rows
		const affinityRows = raw.prepare(
			`SELECT genre, score FROM user_genre_affinity
			 WHERE user_id = ? AND media_type = 'all'
			 ORDER BY score DESC`
		).all(userId) as Array<{ genre: string; score: number }>;
		const affinityOrder = affinityRows.map((r) => r.genre);

		// Sort genre keys by affinity order
		const sortedGenres = Array.from(byGenre.keys()).sort((a, b) => {
			const ai = affinityOrder.indexOf(a);
			const bi = affinityOrder.indexOf(b);
			return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
		});

		let rank = 1;
		for (const genre of sortedGenres) {
			const recs = byGenre.get(genre)!;
			if (recs.length < MIN_ROW_ITEMS) continue;
			const genreSlug = genre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
			resultRows.push({
				id: `genre:${genreSlug}`,
				title: genre,
				subtitle: `Your #${rank} genre`,
				type: 'genre',
				items: recs.slice(0, 20).map((r) => recToItem(r))
			});
			rank++;
		}
	}

	return { hero, rows: resultRows, computedAt: Date.now() };
}

const HOMEPAGE_CACHE_TTL = 60 * 60 * 1000; // 60 min
const HOMEPAGE_CACHE_STALE_TTL = 6 * 60 * 60 * 1000; // serve stale for up to 6h while rebuilding

/** Get cached homepage data for a user. Returns null on cache miss. */
export async function getHomepageCache(userId: string): Promise<HomepageCache | null> {
	return withStaleCache(`homepage:${userId}`, HOMEPAGE_CACHE_TTL, HOMEPAGE_CACHE_STALE_TTL, async () => {
		const result = buildHomepageCache(userId);
		// Don't cache null/empty results — let the eager build path fill the DB
		if (!result || result.rows.length === 0) throw new Error('no-cache');
		return result;
	}).catch(() => null);
}

/** Invalidate homepage cache for a user (e.g., after profile change) */
export function invalidateHomepageCache(userId: string) {
	invalidate(`homepage:${userId}`);
}

/** Default row order */
export const DEFAULT_ROW_ORDER = [
	'continue',
	'trending-movie', 'trending-show',
	'friends', 'time-aware',
	'recommended-movie', 'recommended-show',
	'new',
	'trending-book', 'trending-game',
	'recommended-book', 'recommended-game',
	'genre:*',
	// Fallback combined rows
	'trending', 'recommended'
];

/**
 * Apply user's row ordering preferences.
 * 'genre:*' expands to all genre rows in their current (affinity) order.
 * Continue Watching is always position 0 regardless of rowOrder.
 */
export function applyRowOrder(rows: HomepageRow[], rowOrder?: string[]): HomepageRow[] {
	const order = rowOrder ?? DEFAULT_ROW_ORDER;
	const rowMap = new Map(rows.map((r) => [r.id, r]));
	const genreRows = rows.filter((r) => r.type === 'genre');
	const result: HomepageRow[] = [];
	const placed = new Set<string>();

	for (const id of order) {
		if (id === 'genre:*') {
			// Expand to all genre rows not yet placed
			for (const gr of genreRows) {
				if (!placed.has(gr.id)) {
					result.push(gr);
					placed.add(gr.id);
				}
			}
		} else if (id.startsWith('genre:') && !rowMap.has(id)) {
			// Specific genre that might not exist — skip
			continue;
		} else {
			const row = rowMap.get(id);
			if (row && !placed.has(id)) {
				result.push(row);
				placed.add(id);
			}
		}
	}

	// Append any rows not in the order
	for (const row of rows) {
		if (!placed.has(row.id)) {
			result.push(row);
		}
	}

	return result;
}
