import type { UnifiedMedia, MediaType } from '$lib/adapters/types';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Recommendation types
// ---------------------------------------------------------------------------

export type ReasonType =
	| 'genre_match'
	| 'similar_users'
	| 'friend_shared'
	| 'friend_watched'
	| 'trending'
	| 'time_pattern'
	| 'external'
	| 'similar_item'
	| 'studio_match'
	| 'era_match'
	| 'completion_pattern';

export interface ScoredRecommendation {
	item: UnifiedMedia;
	score: number; // 0-1 relevance
	confidence: number; // 0-1 provider confidence
	provider: string; // provider ID
	reason: string; // human-readable
	reasonType: ReasonType;
	basedOn?: string[]; // item titles that informed this
}

// ---------------------------------------------------------------------------
// Canonical recommendation profile shape.
//
// `user_rec_profiles.config` is the single tuning store — the old
// `recommendation_preferences` table was dropped 2026-04-17 (migration 0010).
// The zod schema is enforced at every boundary that reads or writes a profile.
// ---------------------------------------------------------------------------

const MEDIA_TYPE = z.enum([
	'movie', 'show', 'episode', 'book', 'comic', 'manga',
	'game', 'music', 'album', 'track', 'podcast', 'live', 'audiobook', 'video'
]);

export const RecProfileConfigSchema = z.object({
	weights: z.object({
		contentBased: z.number().min(0).max(1),
		collaborative: z.number().min(0).max(1),
		social: z.number().min(0).max(1),
		trending: z.number().min(0).max(1),
		external: z.number().min(0).max(1)
	}),
	/** Optional 0-100 per media type (legacy `mediaTypeWeights` fold-in). */
	byMediaType: z.record(MEDIA_TYPE, z.number().min(0).max(100)).optional(),
	mediaTypes: z.array(MEDIA_TYPE).optional(),
	genreBoosts: z.record(z.string(), z.number()).optional(),
	genreBans: z.array(z.string()).optional(),
	noveltyFactor: z.number().min(0).max(1).optional(),
	recencyHalfLifeDays: z.number().positive().optional(),
	yearRange: z.object({
		min: z.number().int().optional(),
		max: z.number().int().optional()
	}).optional(),
	minRating: z.number().min(0).max(10).optional(),
	disabledProviders: z.array(z.string()).optional(),
	rowOrder: z.array(z.string()).optional()
});

export type RecProfileConfig = z.infer<typeof RecProfileConfigSchema>;

export const DEFAULT_PROFILE: RecProfileConfig = {
	weights: {
		contentBased: 0.35,
		collaborative: 0.25,
		social: 0.15,
		trending: 0.15,
		external: 0.10
	},
	noveltyFactor: 0.3,
	recencyHalfLifeDays: 30
};

/**
 * Parse an arbitrary JSON string (from `user_rec_profiles.config`) into a
 * safe RecProfileConfig, falling back to DEFAULT_PROFILE if the blob is
 * malformed or missing required fields.
 */
export function parseRecProfileConfig(raw: string | null | undefined): RecProfileConfig {
	if (!raw) return DEFAULT_PROFILE;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return DEFAULT_PROFILE;
	}
	const result = RecProfileConfigSchema.safeParse(parsed);
	if (result.success) return result.data;
	// If the blob has the legacy `mediaTypeWeights` key, try to rescue it.
	if (parsed && typeof parsed === 'object' && 'mediaTypeWeights' in parsed) {
		const legacy = parsed as { mediaTypeWeights?: unknown };
		const rescued: RecProfileConfig = {
			...DEFAULT_PROFILE,
			byMediaType:
				legacy.mediaTypeWeights && typeof legacy.mediaTypeWeights === 'object'
					? (legacy.mediaTypeWeights as Record<string, number>)
					: undefined
		};
		return rescued;
	}
	return DEFAULT_PROFILE;
}

export interface RecommendationContext {
	userId: string;
	mediaType?: string;
	limit: number;
	profile: RecProfileConfig;
	excludeIds: Set<string>; // hidden + already consumed
	timeOfDay?: number; // 0-23
	dayOfWeek?: number; // 0-6
}

/** Provider category mapping — determines which profile weight to use */
export type ProviderCategory = 'contentBased' | 'collaborative' | 'social' | 'trending' | 'external';

export interface RecommendationProvider {
	readonly id: string;
	readonly displayName: string;
	readonly category: ProviderCategory;
	readonly requiresService?: string;

	/** Check if this provider can produce results for the given context */
	isReady(ctx: RecommendationContext): boolean;

	/** Generate recommendations */
	getRecommendations(ctx: RecommendationContext): Promise<ScoredRecommendation[]>;

	/** Pre-compute recommendations for caching (optional) */
	precompute?(userId: string, mediaType: string): Promise<ScoredRecommendation[]>;
}
