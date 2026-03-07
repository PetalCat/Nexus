import { getDb, getRawDb } from '$lib/db';
import type {
	RecommendationProvider,
	RecommendationContext,
	ScoredRecommendation,
	ProviderCategory
} from '../types';

// ---------------------------------------------------------------------------
// Content-Based Recommendation Provider
//
// Uses genre affinity vectors computed from media_events to score candidate
// items the user hasn't consumed yet.
// ---------------------------------------------------------------------------

interface GenreAffinity {
	genre: string;
	score: number;
}

/** Compute genre affinity vector for a user + media type */
export function computeGenreAffinity(
	userId: string,
	mediaType?: string,
	halfLifeDays = 30
): GenreAffinity[] {
	const raw = getRawDb();
	const now = Date.now();
	const ln2 = Math.LN2;

	const conditions = [`user_id = ?`, `event_type IN ('play_stop', 'complete', 'like', 'favorite')`];
	const params: (string | number)[] = [userId];
	if (mediaType) {
		conditions.push(`media_type = ?`);
		params.push(mediaType);
	}

	const rows = raw.prepare(
		`SELECT media_genres, event_type, play_duration_ms, position_ticks, duration_ticks, timestamp
		 FROM media_events
		 WHERE ${conditions.join(' AND ')}
		 ORDER BY timestamp DESC
		 LIMIT 5000`
	).all(...params) as Array<{
		media_genres: string | null;
		event_type: string;
		play_duration_ms: number | null;
		position_ticks: number | null;
		duration_ticks: number | null;
		timestamp: number;
	}>;

	const genreScores = new Map<string, number>();

	for (const row of rows) {
		if (!row.media_genres) continue;

		let genres: string[];
		try {
			genres = JSON.parse(row.media_genres);
		} catch {
			continue;
		}
		if (!Array.isArray(genres) || genres.length === 0) continue;

		const daysSince = (now - row.timestamp) / 86400000;
		const recencyDecay = Math.exp((-ln2 * daysSince) / halfLifeDays);

		let weight = (row.play_duration_ms ?? 0) / 3600000;
		if (weight === 0) weight = 0.1;

		let completionBonus = 1.0;
		if (row.event_type === 'complete') {
			completionBonus = 1.5;
		} else if (
			row.position_ticks &&
			row.duration_ticks &&
			row.duration_ticks > 0 &&
			row.position_ticks / row.duration_ticks > 0.7
		) {
			completionBonus = 1.2;
		}

		let socialBonus = 0;
		if (row.event_type === 'like' || row.event_type === 'favorite') {
			socialBonus = 0.3;
		}

		const eventScore = (weight * recencyDecay * completionBonus) + socialBonus;
		const perGenre = eventScore / genres.length;
		for (const genre of genres) {
			genreScores.set(genre, (genreScores.get(genre) ?? 0) + perGenre);
		}
	}

	const maxScore = Math.max(...genreScores.values(), 0.001);
	return Array.from(genreScores.entries())
		.map(([genre, score]) => ({ genre, score: score / maxScore }))
		.sort((a, b) => b.score - a.score);
}

/** Persist genre affinity vectors to user_genre_affinity table */
export function persistGenreAffinity(userId: string, mediaType: string, affinities: GenreAffinity[]) {
	const raw = getRawDb();
	const now = Date.now();
	raw.prepare(`DELETE FROM user_genre_affinity WHERE user_id = ? AND media_type = ?`).run(userId, mediaType);

	if (affinities.length === 0) return;

	const insert = raw.prepare(
		`INSERT INTO user_genre_affinity (user_id, media_type, genre, score, updated_at)
		 VALUES (?, ?, ?, ?, ?)`
	);
	for (const aff of affinities) {
		insert.run(userId, mediaType, aff.genre, aff.score, now);
	}
}

/** Cosine similarity between a candidate's genres and user's affinity vector */
function genreCosine(candidateGenres: string[], affinity: Map<string, number>): number {
	if (candidateGenres.length === 0 || affinity.size === 0) return 0;

	let dot = 0;
	let candidateMag = 0;

	for (const g of candidateGenres) {
		const a = affinity.get(g) ?? 0;
		dot += a;
		candidateMag += 1;
	}

	let affinityMag = 0;
	for (const v of affinity.values()) {
		affinityMag += v * v;
	}
	affinityMag = Math.sqrt(affinityMag);

	const denom = Math.sqrt(candidateMag) * affinityMag;
	if (denom === 0) return 0;
	return dot / denom;
}

/** Get IDs of items the user has already consumed */
function getConsumedMediaIds(userId: string, mediaType?: string): Set<string> {
	const raw = getRawDb();
	const conditions = [`user_id = ?`];
	const params: (string | number)[] = [userId];
	if (mediaType) {
		conditions.push(`media_type = ?`);
		params.push(mediaType);
	}

	const rows = raw.prepare(
		`SELECT DISTINCT media_id FROM media_events WHERE ${conditions.join(' AND ')}`
	).all(...params) as Array<{ media_id: string }>;

	return new Set(rows.map((r) => r.media_id));
}

export const contentBasedProvider: RecommendationProvider = {
	id: 'content-based',
	displayName: 'Content Match',
	category: 'contentBased' as ProviderCategory,

	isReady(ctx: RecommendationContext): boolean {
		const raw = getRawDb();
		const count = raw.prepare(
			`SELECT COUNT(*) as c FROM media_events WHERE user_id = ? LIMIT 1`
		).get(ctx.userId) as { c: number } | undefined;
		return (count?.c ?? 0) > 0;
	},

	async getRecommendations(ctx: RecommendationContext): Promise<ScoredRecommendation[]> {
		const raw = getRawDb();
		const halfLife = ctx.profile.recencyHalfLifeDays ?? 30;

		const affinities = computeGenreAffinity(ctx.userId, ctx.mediaType, halfLife);
		if (affinities.length === 0) return [];

		const affinityMap = new Map(affinities.map((a) => [a.genre, a.score]));
		const consumed = getConsumedMediaIds(ctx.userId, ctx.mediaType);

		const typeFilter = ctx.mediaType ? `AND type = ?` : '';
		const params: (string | number)[] = [];
		if (ctx.mediaType) params.push(ctx.mediaType);

		const candidates = raw.prepare(
			`SELECT id, source_id, service_id, type, title, description, poster, backdrop,
			        year, rating, genres, studios, duration, status, metadata
			 FROM media_items
			 WHERE 1=1 ${typeFilter}
			 ORDER BY cached_at DESC
			 LIMIT 500`
		).all(...params) as Array<{
			id: string;
			source_id: string;
			service_id: string;
			type: string;
			title: string;
			description: string | null;
			poster: string | null;
			backdrop: string | null;
			year: number | null;
			rating: number | null;
			genres: string | null;
			studios: string | null;
			duration: number | null;
			status: string | null;
			metadata: string | null;
		}>;

		// Compute preferred year from recent events
		const yearParams: (string | number)[] = [ctx.userId];
		if (ctx.mediaType) yearParams.push(ctx.mediaType);
		const recentYears = raw.prepare(
			`SELECT media_year FROM media_events
			 WHERE user_id = ? AND media_year IS NOT NULL
			 ${ctx.mediaType ? 'AND media_type = ?' : ''}
			 ORDER BY timestamp DESC LIMIT 50`
		).all(...yearParams) as Array<{ media_year: number }>;
		const avgYear =
			recentYears.length > 0
				? recentYears.reduce((s, r) => s + r.media_year, 0) / recentYears.length
				: new Date().getFullYear();

		const results: ScoredRecommendation[] = [];

		for (const c of candidates) {
			if (consumed.has(c.source_id) || ctx.excludeIds.has(c.source_id) || ctx.excludeIds.has(c.id)) {
				continue;
			}

			if (ctx.profile.yearRange) {
				if (c.year && ctx.profile.yearRange.min && c.year < ctx.profile.yearRange.min) continue;
				if (c.year && ctx.profile.yearRange.max && c.year > ctx.profile.yearRange.max) continue;
			}

			if (ctx.profile.minRating && c.rating && c.rating < ctx.profile.minRating) continue;

			let genres: string[] = [];
			try {
				genres = c.genres ? JSON.parse(c.genres) : [];
			} catch { /* empty */ }

			if (ctx.profile.genreBans?.some((ban) => genres.includes(ban))) continue;

			const genreScore = genreCosine(genres, affinityMap);
			const eraScore = c.year
				? Math.exp(-Math.pow(c.year - avgYear, 2) / 200)
				: 0.5;
			const ratingScore = c.rating ? c.rating / 10 : 0.5;

			let score = genreScore * 0.60 + eraScore * 0.15 + ratingScore * 0.10;
			score += 0.15 * 0.5; // neutral studio score

			if (ctx.profile.genreBoosts) {
				for (const genre of genres) {
					const boost = ctx.profile.genreBoosts[genre];
					if (boost != null) score *= boost;
				}
			}

			if (score < 0.05) continue;

			const topGenre = genres
				.map((g) => ({ g, s: affinityMap.get(g) ?? 0 }))
				.sort((a, b) => b.s - a.s)[0];

			results.push({
				item: {
					id: c.id,
					sourceId: c.source_id,
					serviceId: c.service_id,
					serviceType: 'jellyfin',
					type: c.type as any,
					title: c.title,
					description: c.description ?? undefined,
					poster: c.poster ?? undefined,
					backdrop: c.backdrop ?? undefined,
					year: c.year ?? undefined,
					rating: c.rating ?? undefined,
					genres,
					duration: c.duration ?? undefined,
					status: c.status as any
				},
				score: Math.min(score, 1),
				confidence: Math.min(affinities.length / 10, 1),
				provider: 'content-based',
				reason: topGenre
					? `Matches your interest in ${topGenre.g}`
					: 'Based on your viewing patterns',
				reasonType: 'genre_match',
				basedOn: affinities.slice(0, 3).map((a) => a.genre)
			});
		}

		return results.sort((a, b) => b.score - a.score).slice(0, ctx.limit * 2);
	}
};
