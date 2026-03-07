import type { RecommendationProvider, RecommendationContext } from './types';

// ---------------------------------------------------------------------------
// Provider registry — simple Map-based registry for recommendation providers
// ---------------------------------------------------------------------------

class ProviderRegistry {
	private providers = new Map<string, RecommendationProvider>();

	register(provider: RecommendationProvider) {
		this.providers.set(provider.id, provider);
		console.log(`[rec-registry] Registered provider: ${provider.displayName}`);
	}

	get(id: string): RecommendationProvider | undefined {
		return this.providers.get(id);
	}

	/** Return all providers that are ready and not disabled by the user profile */
	active(ctx: RecommendationContext): RecommendationProvider[] {
		const disabled = new Set(ctx.profile.disabledProviders ?? []);
		return Array.from(this.providers.values()).filter(
			(p) => !disabled.has(p.id) && p.isReady(ctx)
		);
	}

	all(): RecommendationProvider[] {
		return Array.from(this.providers.values());
	}
}

export const recRegistry = new ProviderRegistry();
