import { getStreamyStatsRecommendations } from '$lib/adapters/streamystats';
import { getEnabledConfigs } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import type {
	RecommendationProvider,
	RecommendationContext,
	ScoredRecommendation,
	ProviderCategory
} from '../types';

// ---------------------------------------------------------------------------
// StreamyStats Provider — wraps existing StreamyStats recommendation API
// ---------------------------------------------------------------------------

export const streamyStatsProvider: RecommendationProvider = {
	id: 'streamystats',
	displayName: 'StreamyStats',
	category: 'external' as ProviderCategory,
	requiresService: 'streamystats',

	isReady(ctx: RecommendationContext): boolean {
		const ssConfigs = getEnabledConfigs().filter((c) => c.type === 'streamystats');
		if (ssConfigs.length === 0) return false;

		// Need a Jellyfin credential for auth
		const jfConfig = getEnabledConfigs().find((c) => c.type === 'jellyfin');
		if (!jfConfig) return false;

		const cred = getUserCredentialForService(ctx.userId, jfConfig.id);
		return !!cred?.accessToken;
	},

	async getRecommendations(ctx: RecommendationContext): Promise<ScoredRecommendation[]> {
		const ssConfigs = getEnabledConfigs().filter((c) => c.type === 'streamystats');
		const jfConfig = getEnabledConfigs().find((c) => c.type === 'jellyfin');
		if (!jfConfig || ssConfigs.length === 0) return [];

		const cred = getUserCredentialForService(ctx.userId, jfConfig.id);
		if (!cred?.accessToken) return [];

		const results: ScoredRecommendation[] = [];

		for (const config of ssConfigs) {
			// Map mediaType to SS type
			const ssTypes: Array<'Movie' | 'Series'> = [];
			if (!ctx.mediaType || ctx.mediaType === 'movie') ssTypes.push('Movie');
			if (!ctx.mediaType || ctx.mediaType === 'show') ssTypes.push('Series');

			for (const ssType of ssTypes) {
				try {
					const items = await getStreamyStatsRecommendations(config, ssType, cred, ctx.limit);

					for (const item of items) {
						if (ctx.excludeIds.has(item.sourceId) || ctx.excludeIds.has(item.id)) continue;

						const reason = (item.metadata?.reason as string) ?? 'Recommended by StreamyStats';
						const similarity = (item.metadata?.similarity as number) ?? 0.5;

						results.push({
							item,
							score: similarity,
							confidence: 0.7, // external service — moderate confidence
							provider: 'streamystats',
							reason,
							reasonType: 'external',
							basedOn: []
						});
					}
				} catch (e) {
					console.error(`[rec:streamystats] Error fetching ${ssType}:`, e instanceof Error ? e.message : e);
				}
			}
		}

		return results;
	}
};
