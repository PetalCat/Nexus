/**
 * Nexus Adapter Registry
 *
 * All service adapters are registered here. To add a custom adapter:
 *
 *   1. Create your adapter file (e.g. src/lib/adapters/my-service.ts)
 *      implementing the ServiceAdapter interface from ./base.ts
 *
 *   2. Import and register it below:
 *      import { myServiceAdapter } from './my-service';
 *      registry.register(myServiceAdapter);
 *
 * The registry is used by the API layer to route requests to the correct
 * adapter based on the service `type` stored in the database.
 */

import type { ServiceAdapter, OnboardingCategory, OnboardingMeta } from './base';
import { jellyfinAdapter } from './jellyfin';
import { calibreAdapter } from './calibre';
import { lidarrAdapter } from './lidarr';
import { overseerrAdapter } from './overseerr';
import { prowlarrAdapter } from './prowlarr';
import { radarrAdapter } from './radarr';
import { rommAdapter } from './romm';
import { sonarrAdapter } from './sonarr';
import { streamystatsAdapter } from './streamystats';
import { bazarrAdapter } from './bazarr';
import { invidiousAdapter } from './invidious';
import { plexAdapter } from './plex';

class AdapterRegistry {
	private adapters = new Map<string, ServiceAdapter>();

	/** Register a service adapter by its `id` */
	register(adapter: ServiceAdapter): this {
		if (this.adapters.has(adapter.id)) {
			console.warn(`[Nexus] Overwriting adapter "${adapter.id}"`);
		}
		this.adapters.set(adapter.id, adapter);
		return this;
	}

	/** Retrieve a registered adapter by service type */
	get(type: string): ServiceAdapter | undefined {
		return this.adapters.get(type);
	}

	/** All registered adapters */
	all(): ServiceAdapter[] {
		return [...this.adapters.values()];
	}

	/** All registered service type IDs */
	types(): string[] {
		return [...this.adapters.keys()];
	}

	/** All adapters that provide browsable media libraries */
	libraries(): ServiceAdapter[] {
		return this.all().filter((a) => a.isLibrary);
	}

	/** All adapters that should appear in unified search, sorted by priority */
	searchable(): ServiceAdapter[] {
		return this.all()
			.filter((a) => a.isSearchable)
			.sort((a, b) => (a.searchPriority ?? Infinity) - (b.searchPriority ?? Infinity));
	}

	/** All adapters matching a given media type */
	byMediaType(mediaType: string): ServiceAdapter[] {
		return this.all().filter((a) => a.mediaTypes?.includes(mediaType as any));
	}

	/** Resolve the adapter that provides auth for this adapter (follows authVia chain) */
	resolveAuthAdapter(adapter: ServiceAdapter): ServiceAdapter | undefined {
		if (!adapter.authVia) return undefined;
		return this.get(adapter.authVia);
	}

	/** Adapters with onboarding metadata */
	onboardable(): ServiceAdapter[] {
		return this.all().filter((a) => a.onboarding);
	}

	/** Adapters in a specific onboarding category */
	byOnboardingCategory(category: OnboardingCategory): ServiceAdapter[] {
		return this.all().filter((a) => a.onboarding?.category === category);
	}
}

// Build and export the singleton registry
export const registry = new AdapterRegistry()
	.register(jellyfinAdapter)
	.register(calibreAdapter)
	.register(rommAdapter)
	.register(overseerrAdapter)
	.register({ ...overseerrAdapter, id: 'seerr', displayName: 'Seerr', color: '#6366f1', abbreviation: 'SR' })
	.register(radarrAdapter)
	.register(sonarrAdapter)
	.register(lidarrAdapter)
	.register(prowlarrAdapter)
	.register(streamystatsAdapter)
	.register(bazarrAdapter)
	.register(invidiousAdapter)
	.register(plexAdapter);

// ── Custom adapter registration ──────────────────────────────────────────────
// Add your own adapters here. They will be picked up automatically.
// Example:
//   import { myAdapter } from './my-adapter';
//   registry.register(myAdapter);
// ─────────────────────────────────────────────────────────────────────────────

export type { ServiceAdapter, OnboardingCategory, OnboardingMeta };
