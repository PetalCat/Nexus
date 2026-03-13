import { getRawDb } from '$lib/db';
import { withCache } from '$lib/server/cache';
import type {
	RecommendationProvider,
	RecommendationContext,
	ScoredRecommendation,
	ProviderCategory
} from '../types';

// ---------------------------------------------------------------------------
// Trending Provider
// ---------------------------------------------------------------------------

interface TrendingItem {
	mediaId: string;
	mediaType: string;
	mediaTitle: string | null;
	mediaYear: number | null;
	mediaGenres: string | null;
	events24h: number;
	events7d: number;
	velocity: number;
	trendingScore: number;
}

/**
 * Aggregate episode events to parent shows for trending.
 * Uses parent_id/parent_title from media_events + show-type events.
 */
function computeTrendingShows(day: number, week: number): TrendingItem[] {
	const raw = getRawDb();

	// Get episode events aggregated by parent show
	const episodeRows = raw.prepare(
		`SELECT parent_id as show_id, parent_title as show_title,
		        MAX(media_genres) as media_genres,
		        COUNT(*) as total_events,
		        SUM(CASE WHEN timestamp > ? THEN 1 ELSE 0 END) as events_24h
		 FROM media_events
		 WHERE timestamp > ?
		   AND media_type = 'episode'
		   AND parent_id IS NOT NULL AND parent_id != ''
		   AND event_type IN ('play_start', 'play_stop', 'complete', 'like', 'favorite')
		 GROUP BY parent_id
		 HAVING total_events >= 2
		 ORDER BY events_24h DESC
		 LIMIT 50`
	).all(day, week) as Array<{
		show_id: string;
		show_title: string | null;
		media_genres: string | null;
		total_events: number;
		events_24h: number;
	}>;

	// Also get direct show-type events
	const showRows = raw.prepare(
		`SELECT media_id as show_id,
		        MAX(media_title) as show_title,
		        MAX(media_genres) as media_genres,
		        COUNT(*) as total_events,
		        SUM(CASE WHEN timestamp > ? THEN 1 ELSE 0 END) as events_24h
		 FROM media_events
		 WHERE timestamp > ?
		   AND media_type = 'show'
		   AND event_type IN ('play_start', 'play_stop', 'complete', 'like', 'favorite')
		 GROUP BY media_id
		 HAVING total_events >= 2
		 ORDER BY events_24h DESC
		 LIMIT 50`
	).all(day, week) as Array<{
		show_id: string;
		show_title: string | null;
		media_genres: string | null;
		total_events: number;
		events_24h: number;
	}>;

	// Merge episode and show events by show_id
	const merged = new Map<string, { title: string | null; genres: string | null; events: number; events24h: number }>();
	for (const rows of [episodeRows, showRows]) {
		for (const r of rows) {
			const existing = merged.get(r.show_id);
			if (existing) {
				existing.events += r.total_events;
				existing.events24h += r.events_24h;
				if (!existing.title && r.show_title) existing.title = r.show_title;
				if (!existing.genres && r.media_genres) existing.genres = r.media_genres;
			} else {
				merged.set(r.show_id, {
					title: r.show_title,
					genres: r.media_genres,
					events: r.total_events,
					events24h: r.events_24h
				});
			}
		}
	}

	return Array.from(merged.entries())
		.map(([showId, data]) => {
			const velocity = data.events > 0 ? data.events24h / data.events : 0;
			return {
				mediaId: showId,
				mediaType: 'show',
				mediaTitle: data.title,
				mediaYear: null,
				mediaGenres: data.genres,
				events24h: data.events24h,
				events7d: data.events,
				velocity,
				trendingScore: velocity * Math.log(data.events + 1)
			};
		})
		.sort((a, b) => b.trendingScore - a.trendingScore)
		.slice(0, 100);
}

function computeTrending(mediaType?: string): TrendingItem[] {
	const raw = getRawDb();
	const now = Date.now();
	const day = now - 24 * 60 * 60 * 1000;
	const week = now - 7 * 24 * 60 * 60 * 1000;

	// For 'show' requests, aggregate episode watches up to their parent show.
	// We only recommend shows — never individual episodes.
	if (mediaType === 'show') {
		return computeTrendingShows(day, week);
	}

	// For specific types, filter directly. For all, exclude episodes (aggregated via show path) and videos (too noisy for trending)
	const typeFilter = mediaType
		? `AND media_type = '${mediaType}'`
		: `AND media_type NOT IN ('episode', 'video')`;

	const rows = raw.prepare(
		`SELECT media_id, media_type,
		        MAX(media_title) as media_title,
		        MAX(media_year) as media_year,
		        MAX(media_genres) as media_genres,
		        COUNT(*) as total_events,
		        SUM(CASE WHEN timestamp > ? THEN 1 ELSE 0 END) as events_24h
		 FROM media_events
		 WHERE timestamp > ? ${typeFilter}
		   AND event_type IN ('play_start', 'play_stop', 'complete', 'like', 'favorite')
		 GROUP BY media_id
		 HAVING total_events >= 2
		 ORDER BY events_24h DESC
		 LIMIT 100`
	).all(day, week) as Array<{
		media_id: string;
		media_type: string;
		media_title: string | null;
		media_year: number | null;
		media_genres: string | null;
		total_events: number;
		events_24h: number;
	}>;

	return rows.map((r) => {
		const velocity = r.total_events > 0 ? r.events_24h / r.total_events : 0;
		return {
			mediaId: r.media_id,
			mediaType: r.media_type,
			mediaTitle: r.media_title,
			mediaYear: r.media_year,
			mediaGenres: r.media_genres,
			events24h: r.events_24h,
			events7d: r.total_events,
			velocity,
			trendingScore: velocity * Math.log(r.total_events + 1)
		};
	}).sort((a, b) => b.trendingScore - a.trendingScore);
}

export const trendingProvider: RecommendationProvider = {
	id: 'trending',
	displayName: 'Trending Now',
	category: 'trending' as ProviderCategory,

	isReady(_ctx: RecommendationContext): boolean {
		const raw = getRawDb();
		const week = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const count = raw.prepare(
			`SELECT COUNT(*) as c FROM media_events WHERE timestamp > ?`
		).get(week) as { c: number } | undefined;
		return (count?.c ?? 0) >= 5;
	},

	async getRecommendations(ctx: RecommendationContext): Promise<ScoredRecommendation[]> {
		const raw = getRawDb();

		const trending = await withCache(
			`trending:${ctx.mediaType ?? 'all'}`,
			5 * 60 * 1000,
			async () => computeTrending(ctx.mediaType)
		);

		if (trending.length === 0) return [];

		// Resolve the Jellyfin service ID and URL for fallback items
		const jellyfinService = raw.prepare(
			`SELECT id, url FROM services WHERE type = 'jellyfin' LIMIT 1`
		).get() as { id: string; url: string } | undefined;
		const jfServiceId = jellyfinService?.id ?? '';
		const jfBaseUrl = jellyfinService?.url ?? '';

		const maxScore = Math.max(...trending.map((t) => t.trendingScore), 0.001);
		const results: ScoredRecommendation[] = [];

		for (const t of trending) {
			// Only skip explicitly hidden items — trending shows popular content
			// even if the user has already consumed it
			if (ctx.excludeIds.has(t.mediaId)) continue;

			let genres: string[] = [];
			try { genres = t.mediaGenres ? JSON.parse(t.mediaGenres) : []; } catch { /* */ }
			if (ctx.profile.genreBans?.some((ban) => genres.includes(ban))) continue;

			const cached = raw.prepare(
				`SELECT * FROM media_items WHERE source_id = ? LIMIT 1`
			).get(t.mediaId) as any;

			const normalizedScore = t.trendingScore / maxScore;

			// Build image URLs based on service type
			let poster: string | undefined;
			let backdrop: string | undefined;
			const serviceId = raw.prepare(
				`SELECT service_id FROM media_events WHERE media_id = ? AND service_id != '' LIMIT 1`
			).get(t.mediaId) as { service_id: string } | undefined;
			const itemServiceId = serviceId?.service_id ?? jfServiceId;

			if (t.mediaType === 'video') {
				// YouTube/Invidious thumbnails
				poster = `https://i.ytimg.com/vi/${t.mediaId}/mqdefault.jpg`;
				backdrop = `https://i.ytimg.com/vi/${t.mediaId}/maxresdefault.jpg`;
			} else if (jfBaseUrl) {
				poster = `${jfBaseUrl}/Items/${t.mediaId}/Images/Primary?quality=90&maxWidth=400`;
				backdrop = `${jfBaseUrl}/Items/${t.mediaId}/Images/Backdrop?quality=90&maxWidth=1920`;
			}

			results.push({
				item: cached
					? {
							id: cached.id,
							sourceId: cached.source_id,
							serviceId: cached.service_id,
							serviceType: 'jellyfin',
							type: cached.type,
							title: cached.title,
							description: cached.description ?? undefined,
							poster: cached.poster ?? undefined,
							backdrop: cached.backdrop ?? undefined,
							year: cached.year ?? undefined,
							rating: cached.rating ?? undefined,
							genres: cached.genres ? JSON.parse(cached.genres) : genres,
							duration: cached.duration ?? undefined
					  }
					: {
							id: `${t.mediaId}:${itemServiceId}`,
							sourceId: t.mediaId,
							serviceId: itemServiceId,
							serviceType: t.mediaType === 'video' ? 'invidious' : (jfServiceId ? 'jellyfin' : 'unknown'),
							type: t.mediaType as any,
							title: t.mediaTitle ?? 'Unknown',
							year: t.mediaYear ?? undefined,
							genres,
							poster,
							backdrop
					  },
				score: normalizedScore,
				confidence: Math.min(t.events7d / 20, 1),
				provider: 'trending',
				reason: 'Popular on Nexus this week',
				reasonType: 'trending'
			});
		}

		return results.slice(0, ctx.limit);
	}
};
