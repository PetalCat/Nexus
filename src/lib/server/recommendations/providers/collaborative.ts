import { getRawDb } from '$lib/db';
import type {
	RecommendationProvider,
	RecommendationContext,
	ScoredRecommendation,
	ProviderCategory
} from '../types';

// ---------------------------------------------------------------------------
// Collaborative Filtering Provider
// ---------------------------------------------------------------------------

interface UserSimilarity {
	userId: string;
	similarity: number;
}

let similarityCache = new Map<string, UserSimilarity[]>();
let lastSimilarityBuild = 0;
const SIMILARITY_TTL_MS = 2 * 60 * 60 * 1000;

function getGenreVector(userId: string): Map<string, number> {
	const raw = getRawDb();
	const rows = raw.prepare(
		`SELECT genre, score FROM user_genre_affinity WHERE user_id = ? AND media_type = 'all'`
	).all(userId) as Array<{ genre: string; score: number }>;
	return new Map(rows.map((r) => [r.genre, r.score]));
}

function getWatchedSet(userId: string): Set<string> {
	const raw = getRawDb();
	const rows = raw.prepare(
		`SELECT DISTINCT media_id FROM play_sessions WHERE user_id = ?`
	).all(userId) as Array<{ media_id: string }>;
	return new Set(rows.map((r) => r.media_id));
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
	let dot = 0, magA = 0, magB = 0;
	const allGenres = new Set([...a.keys(), ...b.keys()]);
	for (const g of allGenres) {
		const va = a.get(g) ?? 0;
		const vb = b.get(g) ?? 0;
		dot += va * vb;
		magA += va * va;
		magB += vb * vb;
	}
	const denom = Math.sqrt(magA) * Math.sqrt(magB);
	return denom === 0 ? 0 : dot / denom;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	let intersection = 0;
	for (const item of a) {
		if (b.has(item)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

function getEligibleUserIds(minEvents: number): string[] {
	const raw = getRawDb();
	const rows = raw.prepare(
		`SELECT user_id, COUNT(*) as c FROM play_sessions
		 GROUP BY user_id HAVING c >= ?`
	).all(minEvents) as Array<{ user_id: string; c: number }>;
	return rows.map((r) => r.user_id);
}

function buildSimilarityForUser(targetId: string, allUserIds: string[]): UserSimilarity[] {
	const targetGenres = getGenreVector(targetId);
	const targetWatched = getWatchedSet(targetId);
	const similarities: UserSimilarity[] = [];

	for (const otherId of allUserIds) {
		if (otherId === targetId) continue;
		const genreSim = cosineSimilarity(targetGenres, getGenreVector(otherId));
		const watchSim = jaccardSimilarity(targetWatched, getWatchedSet(otherId));
		const combined = 0.6 * genreSim + 0.4 * watchSim;
		if (combined >= 0.3) {
			similarities.push({ userId: otherId, similarity: combined });
		}
	}

	return similarities.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
}

function ensureSimilarityMatrix(targetId: string) {
	if (Date.now() - lastSimilarityBuild < SIMILARITY_TTL_MS && similarityCache.has(targetId)) return;
	const allUserIds = getEligibleUserIds(10);
	if (allUserIds.length < 3) return;
	similarityCache.set(targetId, buildSimilarityForUser(targetId, allUserIds));
	lastSimilarityBuild = Date.now();
}

export const collaborativeProvider: RecommendationProvider = {
	id: 'collaborative',
	displayName: 'People Like You',
	category: 'collaborative' as ProviderCategory,

	isReady(ctx: RecommendationContext): boolean {
		const eligible = getEligibleUserIds(10);
		return eligible.length >= 3 && eligible.includes(ctx.userId);
	},

	async getRecommendations(ctx: RecommendationContext): Promise<ScoredRecommendation[]> {
		const raw = getRawDb();
		ensureSimilarityMatrix(ctx.userId);

		const neighbors = similarityCache.get(ctx.userId);
		if (!neighbors || neighbors.length === 0) return [];

		const targetWatched = getWatchedSet(ctx.userId);
		const results: ScoredRecommendation[] = [];
		const seen = new Set<string>();

		for (const neighbor of neighbors) {
			const typeFilter = ctx.mediaType ? `AND media_type = ?` : '';
			const params: (string | number)[] = [neighbor.userId];
			if (ctx.mediaType) params.push(ctx.mediaType);

			const items = raw.prepare(
				`SELECT DISTINCT media_id, media_type, media_title, NULL as media_year, media_genres
				 FROM play_sessions
				 WHERE user_id = ? AND completed = 1
				 ${typeFilter}
				 ORDER BY started_at DESC
				 LIMIT 50`
			).all(...params) as Array<{
				media_id: string;
				media_type: string;
				media_title: string | null;
				media_year: number | null;
				media_genres: string | null;
			}>;

			for (const item of items) {
				if (targetWatched.has(item.media_id) || ctx.excludeIds.has(item.media_id) || seen.has(item.media_id)) continue;
				seen.add(item.media_id);

				let genres: string[] = [];
				try { genres = item.media_genres ? JSON.parse(item.media_genres) : []; } catch { /* */ }
				if (ctx.profile.genreBans?.some((ban) => genres.includes(ban))) continue;

				const cached = raw.prepare(
					`SELECT * FROM media_items WHERE source_id = ? LIMIT 1`
				).get(item.media_id) as any;

				const score = neighbor.similarity * 0.8;

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
								duration: cached.duration ?? undefined,
								status: cached.status as any
						  }
						: {
								id: `${item.media_id}:collab`,
								sourceId: item.media_id,
								serviceId: '',
								serviceType: 'unknown',
								type: item.media_type as any,
								title: item.media_title ?? 'Unknown',
								year: item.media_year ?? undefined,
								genres
						  },
					score,
					confidence: Math.min(neighbor.similarity, 1),
					provider: 'collaborative',
					reason: `Popular with viewers who share your taste`,
					reasonType: 'similar_users'
				});
			}
		}

		return results.sort((a, b) => b.score - a.score).slice(0, ctx.limit);
	}
};
