import { getRawDb } from '$lib/db';
import type {
	RecommendationProvider,
	RecommendationContext,
	ScoredRecommendation,
	ProviderCategory
} from '../types';

// ---------------------------------------------------------------------------
// Time-Aware Provider (re-ranker)
// ---------------------------------------------------------------------------

function buildTimeModel(userId: string): Map<number, Map<string, number>> {
	const raw = getRawDb();
	const rows = raw.prepare(
		`SELECT timestamp, media_genres FROM media_events
		 WHERE user_id = ? AND media_genres IS NOT NULL
		   AND event_type IN ('play_start', 'play_stop', 'complete')
		 ORDER BY timestamp DESC LIMIT 2000`
	).all(userId) as Array<{ timestamp: number; media_genres: string }>;

	const model = new Map<number, Map<string, number>>();

	for (const row of rows) {
		const hour = new Date(row.timestamp).getHours();
		let genres: string[];
		try { genres = JSON.parse(row.media_genres); } catch { continue; }

		if (!model.has(hour)) model.set(hour, new Map());
		const hourMap = model.get(hour)!;

		for (const genre of genres) {
			hourMap.set(genre, (hourMap.get(genre) ?? 0) + 1);
		}
	}

	return model;
}

function timeRelevance(
	genres: string[],
	hour: number,
	_isWeekend: boolean,
	model: Map<number, Map<string, number>>
): number {
	if (model.size === 0 || genres.length === 0) return 1.0;

	const hourMap = model.get(hour);
	if (!hourMap) return 1.0;

	let matchCount = 0;
	let totalCount = 0;

	for (const [, count] of hourMap) {
		totalCount += count;
	}
	if (totalCount === 0) return 1.0;

	for (const genre of genres) {
		matchCount += hourMap.get(genre) ?? 0;
	}

	const ratio = matchCount / totalCount;
	return 0.7 + ratio * 0.6;
}

export const timeAwareProvider: RecommendationProvider = {
	id: 'time-aware',
	displayName: 'Right Time',
	category: 'contentBased' as ProviderCategory,

	isReady(ctx: RecommendationContext): boolean {
		const raw = getRawDb();
		const count = raw.prepare(
			`SELECT COUNT(*) as c FROM media_events WHERE user_id = ? AND media_genres IS NOT NULL LIMIT 1`
		).get(ctx.userId) as { c: number } | undefined;
		return (count?.c ?? 0) >= 20;
	},

	async getRecommendations(ctx: RecommendationContext): Promise<ScoredRecommendation[]> {
		const raw = getRawDb();
		const model = buildTimeModel(ctx.userId);
		if (model.size === 0) return [];

		const hour = ctx.timeOfDay ?? new Date().getHours();
		const isWeekend = ctx.dayOfWeek != null ? (ctx.dayOfWeek === 0 || ctx.dayOfWeek === 6) : false;

		const hourMap = model.get(hour);
		if (!hourMap || hourMap.size === 0) return [];

		const topGenres = Array.from(hourMap.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([genre]) => genre);

		if (topGenres.length === 0) return [];

		const consumed = new Set(
			(raw.prepare(`SELECT DISTINCT media_id FROM media_events WHERE user_id = ?`).all(ctx.userId) as Array<{ media_id: string }>)
				.map((r) => r.media_id)
		);

		const typeFilter = ctx.mediaType ? `AND type = ?` : '';
		const params: (string | number)[] = [];
		if (ctx.mediaType) params.push(ctx.mediaType);

		const candidates = raw.prepare(
			`SELECT * FROM media_items WHERE genres IS NOT NULL ${typeFilter}
			 ORDER BY cached_at DESC LIMIT 200`
		).all(...params) as any[];

		const results: ScoredRecommendation[] = [];

		for (const c of candidates) {
			if (consumed.has(c.source_id) || ctx.excludeIds.has(c.source_id)) continue;

			let genres: string[];
			try { genres = JSON.parse(c.genres); } catch { continue; }

			const relevance = timeRelevance(genres, hour, isWeekend, model);
			if (relevance <= 1.0) continue;

			const matchingGenres = genres.filter((g: string) => topGenres.includes(g));
			if (matchingGenres.length === 0) continue;

			results.push({
				item: {
					id: c.id,
					sourceId: c.source_id,
					serviceId: c.service_id,
					serviceType: 'jellyfin',
					type: c.type,
					title: c.title,
					description: c.description ?? undefined,
					poster: c.poster ?? undefined,
					backdrop: c.backdrop ?? undefined,
					year: c.year ?? undefined,
					rating: c.rating ?? undefined,
					genres,
					duration: c.duration ?? undefined
				},
				score: relevance * 0.5,
				confidence: 0.4,
				provider: 'time-aware',
				reason: `Great for ${hour >= 20 || hour < 5 ? 'tonight' : hour >= 12 ? 'this afternoon' : 'this morning'}`,
				reasonType: 'time_pattern'
			});
		}

		return results.sort((a, b) => b.score - a.score).slice(0, ctx.limit);
	}
};
