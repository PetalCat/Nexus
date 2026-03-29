import { getStreamyStatsRecommendations } from '$lib/adapters/streamystats';
import { registry } from '$lib/adapters/registry';
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

		// Resolve auth adapter via registry (e.g. StreamyStats authenticates via Jellyfin)
		const ssAdapter = registry.get('streamystats');
		const authAdapterId = ssAdapter?.authVia;
		const authConfig = authAdapterId ? getEnabledConfigs().find((c) => c.type === authAdapterId) : undefined;
		if (!authConfig) return false;

		const cred = getUserCredentialForService(ctx.userId, authConfig.id);
		return !!cred?.accessToken;
	},

	async getRecommendations(ctx: RecommendationContext): Promise<ScoredRecommendation[]> {
		const ssConfigs = getEnabledConfigs().filter((c) => c.type === 'streamystats');
		const ssAdapter = registry.get('streamystats');
		const authAdapterId = ssAdapter?.authVia;
		const authConfig = authAdapterId ? getEnabledConfigs().find((c) => c.type === authAdapterId) : undefined;
		if (!authConfig || ssConfigs.length === 0) return [];

		const cred = getUserCredentialForService(ctx.userId, authConfig.id);
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
