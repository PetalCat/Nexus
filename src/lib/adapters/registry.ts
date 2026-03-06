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

import type { ServiceAdapter } from './base';
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
}

// Build and export the singleton registry
export const registry = new AdapterRegistry()
	.register(jellyfinAdapter)
	.register(calibreAdapter)
	.register(rommAdapter)
	.register(overseerrAdapter)
	.register(radarrAdapter)
	.register(sonarrAdapter)
	.register(lidarrAdapter)
	.register(prowlarrAdapter)
	.register(streamystatsAdapter)
	.register(bazarrAdapter);

// ── Custom adapter registration ──────────────────────────────────────────────
// Add your own adapters here. They will be picked up automatically.
// Example:
//   import { myAdapter } from './my-adapter';
//   registry.register(myAdapter);
// ─────────────────────────────────────────────────────────────────────────────

export type { ServiceAdapter };
