import type { UnifiedMedia, MediaType } from '$lib/adapters/types';

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

export interface RecProfileConfig {
	weights: {
		contentBased: number;
		collaborative: number;
		social: number;
		trending: number;
		external: number;
	};
	mediaTypes?: MediaType[];
	genreBoosts?: Record<string, number>; // multipliers (>1 boost, <1 suppress)
	genreBans?: string[]; // completely exclude
	noveltyFactor?: number; // 0=familiar, 1=discovery
	recencyHalfLifeDays?: number; // exponential decay half-life
	yearRange?: { min?: number; max?: number };
	minRating?: number;
	disabledProviders?: string[];
}

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
