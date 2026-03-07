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

function computeTrending(mediaType?: string): TrendingItem[] {
	const raw = getRawDb();
	const now = Date.now();
	const day = now - 24 * 60 * 60 * 1000;
	const week = now - 7 * 24 * 60 * 60 * 1000;

	const typeFilter = mediaType ? `AND media_type = ?` : '';
	const params: (string | number)[] = [day, week];
	if (mediaType) params.push(mediaType);

	const rows = raw.prepare(
		`SELECT media_id, media_type, media_title, media_year, media_genres,
		        COUNT(*) as total_events,
		        SUM(CASE WHEN timestamp > ? THEN 1 ELSE 0 END) as events_24h
		 FROM media_events
		 WHERE timestamp > ? ${typeFilter}
		   AND event_type IN ('play_start', 'play_stop', 'complete', 'like', 'favorite')
		 GROUP BY media_id
		 HAVING total_events >= 2
		 ORDER BY events_24h DESC
		 LIMIT 100`
	).all(...params) as Array<{
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

		const consumed = new Set(
			(raw.prepare(`SELECT DISTINCT media_id FROM media_events WHERE user_id = ?`).all(ctx.userId) as Array<{ media_id: string }>)
				.map((r) => r.media_id)
		);

		const maxScore = Math.max(...trending.map((t) => t.trendingScore), 0.001);
		const results: ScoredRecommendation[] = [];

		for (const t of trending) {
			if (consumed.has(t.mediaId) || ctx.excludeIds.has(t.mediaId)) continue;

			let genres: string[] = [];
			try { genres = t.mediaGenres ? JSON.parse(t.mediaGenres) : []; } catch { /* */ }
			if (ctx.profile.genreBans?.some((ban) => genres.includes(ban))) continue;

			const cached = raw.prepare(
				`SELECT * FROM media_items WHERE source_id = ? LIMIT 1`
			).get(t.mediaId) as any;

			const normalizedScore = t.trendingScore / maxScore;

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
							id: `${t.mediaId}:trending`,
							sourceId: t.mediaId,
							serviceId: '',
							serviceType: 'unknown',
							type: t.mediaType as any,
							title: t.mediaTitle ?? 'Unknown',
							year: t.mediaYear ?? undefined,
							genres
					  },
				score: normalizedScore,
				confidence: Math.min(t.events7d / 20, 1),
				provider: 'trending',
				reason: `Trending — ${t.events24h} plays in the last 24h`,
				reasonType: 'trending'
			});
		}

		return results.slice(0, ctx.limit);
	}
};
