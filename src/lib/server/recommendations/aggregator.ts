import { getRawDb } from '$lib/db';
import type { DashboardRow } from '$lib/adapters/types';
import { withCache } from '$lib/server/cache';
import { recRegistry } from './registry';
import type { ScoredRecommendation, RecommendationContext, RecProfileConfig } from './types';
import { DEFAULT_PROFILE } from './types';

// ---------------------------------------------------------------------------
// Aggregator — orchestrates all providers, deduplicates, scores, caches
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

/** Load user's default recommendation profile, or return global default */
function loadUserProfile(userId: string): RecProfileConfig {
	const raw = getRawDb();
	const row = raw.prepare(
		`SELECT config FROM user_rec_profiles WHERE user_id = ? AND is_default = 1 LIMIT 1`
	).get(userId) as { config: string } | undefined;

	if (row?.config) {
		try {
			return { ...DEFAULT_PROFILE, ...JSON.parse(row.config) };
		} catch { /* fallback */ }
	}
	return DEFAULT_PROFILE;
}

/** Load hidden item IDs for exclusion */
function loadHiddenIds(userId: string): Set<string> {
	const raw = getRawDb();
	const rows = raw.prepare(
		`SELECT media_id FROM user_hidden_items WHERE user_id = ?`
	).all(userId) as Array<{ media_id: string }>;
	return new Set(rows.map((r) => r.media_id));
}

/** Check if cached results are still fresh */
function getCachedResults(
	userId: string,
	mediaType: string | undefined,
	profileId: string
): ScoredRecommendation[] | null {
	const raw = getRawDb();
	const mt = mediaType ?? 'all';
	const row = raw.prepare(
		`SELECT results, computed_at FROM recommendation_cache
		 WHERE user_id = ? AND profile_id = ? AND media_type = ?
		 LIMIT 1`
	).get(userId, profileId, mt) as { results: string; computed_at: number } | undefined;

	if (!row) return null;
	if (Date.now() - row.computed_at > CACHE_TTL_MS) return null;

	try {
		return JSON.parse(row.results);
	} catch {
		return null;
	}
}

/** Persist results to recommendation_cache */
function cacheResults(
	userId: string,
	mediaType: string | undefined,
	profileId: string,
	results: ScoredRecommendation[]
) {
	const raw = getRawDb();
	const mt = mediaType ?? 'all';
	raw.prepare(
		`INSERT INTO recommendation_cache (user_id, profile_id, provider, media_type, results, computed_at)
		 VALUES (?, ?, 'aggregator', ?, ?, ?)
		 ON CONFLICT(user_id, profile_id, provider, media_type) DO UPDATE SET
		   results = excluded.results,
		   computed_at = excluded.computed_at`
	).run(userId, profileId, mt, JSON.stringify(results), Date.now());
}

/** Deduplicate recommendations by sourceId, merging scores from multiple providers */
function deduplicateAndMerge(recs: ScoredRecommendation[]): ScoredRecommendation[] {
	const bySourceId = new Map<string, ScoredRecommendation[]>();

	for (const rec of recs) {
		const key = rec.item.sourceId;
		const existing = bySourceId.get(key);
		if (existing) {
			existing.push(rec);
		} else {
			bySourceId.set(key, [rec]);
		}
	}

	const merged: ScoredRecommendation[] = [];
	for (const [, group] of bySourceId) {
		if (group.length === 1) {
			merged.push(group[0]);
			continue;
		}

		const totalScore = group.reduce((s, r) => s + r.score, 0);
		const avgScore = totalScore / group.length;
		const bestConfidence = Math.max(...group.map((r) => r.confidence));
		const basedOn = [...new Set(group.flatMap((r) => r.basedOn ?? []))];

		const best = group.sort((a, b) => b.score - a.score)[0];

		merged.push({
			item: best.item,
			score: avgScore,
			confidence: bestConfidence,
			provider: group.map((r) => r.provider).join('+'),
			reason: best.reason,
			reasonType: best.reasonType,
			basedOn
		});
	}

	return merged;
}

/** Apply novelty mixing: blend familiar high-score items with novel lower-score items */
function applyNoveltyMixing(
	recs: ScoredRecommendation[],
	noveltyFactor: number,
	limit: number
): ScoredRecommendation[] {
	if (noveltyFactor <= 0 || recs.length <= limit) return recs.slice(0, limit);

	const midpoint = Math.floor(recs.length / 2);
	const familiar = recs.slice(0, midpoint);
	const novel = recs.slice(midpoint);

	const familiarCount = Math.round(limit * (1 - noveltyFactor));
	const novelCount = limit - familiarCount;

	return [
		...familiar.slice(0, familiarCount),
		...novel.slice(0, novelCount)
	].sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get unified recommendations for a user */
export async function getRecommendations(
	userId: string,
	mediaType?: string,
	limit = 20,
	profileOverride?: RecProfileConfig
): Promise<ScoredRecommendation[]> {
	const profile = profileOverride ?? loadUserProfile(userId);
	const profileId = 'default';

	// Check cache
	const cached = getCachedResults(userId, mediaType, profileId);
	if (cached) return cached.slice(0, limit);

	// Build context
	const hiddenIds = loadHiddenIds(userId);
	const now = new Date();
	const ctx: RecommendationContext = {
		userId,
		mediaType,
		limit: limit * 3,
		profile,
		excludeIds: hiddenIds,
		timeOfDay: now.getHours(),
		dayOfWeek: now.getDay()
	};

	// Dispatch to all active providers in parallel
	const providers = recRegistry.active(ctx);
	console.log(`[rec-agg] Active providers for ${mediaType ?? 'all'}: ${providers.map(p => p.id).join(', ') || 'NONE'} (registry has ${recRegistry.all().length} total)`);
	if (providers.length === 0) return [];

	const providerResults = await Promise.allSettled(
		providers.map(async (p) => {
			const recs = await p.getRecommendations(ctx);
			console.log(`[rec-agg] Provider ${p.id} returned ${recs.length} results for ${mediaType ?? 'all'}`);
			const weight = profile.weights[p.category] ?? 0.5;
			return recs.map((r) => ({ ...r, score: r.score * weight }));
		})
	);

	let allRecs = providerResults.flatMap((r) => {
		if (r.status === 'rejected') console.error(`[rec-agg] Provider failed:`, r.reason);
		return r.status === 'fulfilled' ? r.value : [];
	});

	allRecs = deduplicateAndMerge(allRecs);

	if (profile.genreBans?.length) {
		allRecs = allRecs.filter((r) => {
			const genres = r.item.genres ?? [];
			return !profile.genreBans!.some((ban) => genres.includes(ban));
		});
	}
	if (profile.genreBoosts) {
		for (const rec of allRecs) {
			for (const genre of rec.item.genres ?? []) {
				const boost = profile.genreBoosts[genre];
				if (boost != null) rec.score *= boost;
			}
		}
	}

	allRecs.sort((a, b) => b.score - a.score);

	const novelty = profile.noveltyFactor ?? 0.3;
	allRecs = applyNoveltyMixing(allRecs, novelty, limit);

	cacheResults(userId, mediaType, profileId, allRecs);

	return allRecs;
}

/** Produce homepage dashboard rows from the recommendation engine */
export async function getRecommendationRows(userId: string): Promise<DashboardRow[]> {
	const cacheKey = `rec-rows:${userId}`;

	return withCache(cacheKey, 300_000, async () => {
		const rows: DashboardRow[] = [];

		const movieRecs = await getRecommendations(userId, 'movie', 24);
		if (movieRecs.length > 0) {
			rows.push({
				id: `for-you-movies`,
				title: 'For You — Movies',
				subtitle: 'Personalized picks based on your viewing history',
				items: movieRecs.map((r) => ({
					...r.item,
					metadata: {
						...r.item.metadata,
						recReason: r.reason,
						recScore: r.score,
						recProvider: r.provider
					}
				}))
			});
		}

		const showRecs = await getRecommendations(userId, 'show', 24);
		if (showRecs.length > 0) {
			rows.push({
				id: `for-you-shows`,
				title: 'For You — Shows',
				subtitle: 'Personalized picks based on your viewing history',
				items: showRecs.map((r) => ({
					...r.item,
					metadata: {
						...r.item.metadata,
						recReason: r.reason,
						recScore: r.score,
						recProvider: r.provider
					}
				}))
			});
		}

		return rows;
	});
}
